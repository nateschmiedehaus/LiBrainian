/**
 * @fileoverview SQLite storage implementation for LiBrainian
 *
 * Uses better-sqlite3 for synchronous, fast operations.
 * Embeddings stored as BLOBs; similarity search via brute-force cosine
 * (upgradeable to sqlite-vss in Phase 2).
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as fsSync from 'node:fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  LiBrainianStorage,
  StorageCapabilities,
  QueryOptions,
  ContextPackQueryOptions,
  GraphEdgeQueryOptions,
  SimilaritySearchOptions,
  SimilarityResult,
  SimilaritySearchResponse,
  MultiVectorRecord,
  MultiVectorQueryOptions,
  TransactionContext,
  StorageStats,
  StorageBackend,
  EmbeddingMetadata,
  IngestionQueryOptions,
  QueryCacheEntry,
  QueryCachePruneOptions,
  RetrievalConfidenceLogEntry,
  RetrievalConfidenceLogQueryOptions,
  RetrievalStrategyReward,
  RetrievalStrategySelection,
  RetrievalStrategySelectionQueryOptions,
  QueryAccessLogEntry,
  QueryAccessLogQueryOptions,
  ExplorationSuggestion,
  ExplorationSuggestionQueryOptions,
  EvolutionOutcome,
  EvolutionOutcomeQueryOptions,
  LearnedMissingContext,
  QualityScoreHistory,
  TestMapping,
  TestMappingQueryOptions,
  LiBrainianCommit,
  CommitQueryOptions,
  FileOwnership,
  OwnershipQueryOptions,
  GraphMetricsQueryOptions,
  CochangeQueryOptions,
  EvidenceVerificationOptions,
  EvidenceVerificationSummary,
  ConfidenceEvent,
  ConfidenceEventQueryOptions,
  UniversalKnowledgeRecord,
  UniversalKnowledgeQueryOptions,
  UniversalKnowledgeSimilarityOptions,
  UniversalKnowledgeSimilarityResult,
  FileQueryOptions,
  DirectoryQueryOptions,
  AssessmentQueryOptions,
  // Advanced analysis types (migration 010)
  SCCEntry,
  SCCQueryOptions,
  CFGEdge,
  CFGQueryOptions,
  BayesianConfidence,
  BayesianConfidenceQueryOptions,
  StabilityMetrics,
  StabilityQueryOptions,
  FeedbackLoop,
  FeedbackLoopQueryOptions,
  GraphCacheEntry,
  // Advanced library features (migration 011)
  BlameEntry,
  BlameQueryOptions,
  BlameStats,
  DiffRecord,
  DiffHunk,
  DiffQueryOptions,
  ReflogEntry,
  ReflogQueryOptions,
  CloneEntry,
  CloneQueryOptions,
  CloneCluster,
  DebtMetrics,
  DebtQueryOptions,
  DebtHotspot,
  KnowledgeGraphEdge,
  KnowledgeEdgeType,
  KnowledgeEdgeQueryOptions,
  KnowledgeSubgraph,
  FaultLocalization,
  FaultLocalizationQueryOptions,
  EmbeddableEntityType,
  IndexChangeEvent,
  IndexChangeEventType,
  IndexChangeQueryOptions,
} from './types.js';
import type { FlashAssessment, FlashFinding } from '../knowledge/extractors/flash_assessments.js';
import { VectorIndex } from './vector_index.js';
import type { GraphMetricsEntry } from '../graphs/metrics.js';
import type { CochangeEdge } from '../graphs/temporal_graph.js';
import type { EvidenceEntry, EvidenceRef } from '../api/evidence.js';
import type {
  LiBrainianVersion,
  LiBrainianMetadata,
  FunctionKnowledge,
  ModuleKnowledge,
  FileKnowledge,
  DirectoryKnowledge,
  CodeSnippet,
  ContextPack,
  GraphEdge,
  IndexingResult,
  IndexingError,
  BootstrapReport,
  BootstrapPhaseResult,
} from '../types.js';
import type { IngestionItem } from '../ingest/types.js';
import { LIBRARIAN_VERSION } from '../index.js';
import { applyMigrations } from '../api/migrations.js';
import { noResult } from '../api/empty_values.js';
import { safeJsonParse, safeJsonParseOrNull, getResultErrorMessage } from '../utils/safe_json.js';
import { attemptStorageRecovery } from './storage_recovery.js';
import { TransactionConflictError } from './transactions.js';
import { sha256Hex } from '../spine/hashes.js';
import {
  createEmptyRedactionCounts,
  createRedactionAuditReport,
  mergeRedactionCounts,
  minimizeSnippet,
  redactText,
  writeRedactionAuditReport,
  type RedactionCounts,
} from '../api/redaction.js';
import { logWarning } from '../telemetry/logger.js';
import { globalEventBus, createIndexChangeEvent } from '../events.js';

// ============================================================================
// LOCK CONFIGURATION
// ============================================================================

/** Maximum time to wait while trying to recover/reacquire a stale lock */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const LOCK_RETRY_INTERVAL_MS = 200;
const EMBEDDING_INVALID_NORM_TOLERANCE = 1e-10;
const EVIDENCE_FUZZY_MAX_DISTANCE_RATIO = 0.05;
const EVIDENCE_MIN_FUZZY_LINES = 3;
const PROCESS_STARTED_AT_ISO = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();

interface StoredEvidenceRow {
  claim_id: string;
  entity_id: string;
  entity_type: 'function' | 'module';
  file_path: string;
  line_start: number;
  line_end: number | null;
  snippet: string;
  claim: string;
  confidence: EvidenceRef['confidence'];
  created_at: string;
  content_hash: string | null;
  verified_at: string | null;
  is_stale: number;
}

interface EvidenceFileState {
  missing: boolean;
  content?: string;
  lines?: string[];
  contentHash?: string;
  mtimeMs?: number;
}

interface StorageProcessLockCore {
  pid: number;
  startedAt: string;
  processStartedAt: string;
  token: string;
}

interface StorageProcessLockState extends StorageProcessLockCore {
  contentHash: string;
}

interface ObservedStorageLockState {
  pid: number;
  startedAt: string;
  processStartedAt?: string;
  token?: string;
  contentHashValid: boolean;
}

function serializeStorageLockCore(core: StorageProcessLockCore): string {
  return JSON.stringify({
    pid: core.pid,
    startedAt: core.startedAt,
    processStartedAt: core.processStartedAt,
    token: core.token,
  });
}

function createStorageProcessLockState(): StorageProcessLockState {
  const core: StorageProcessLockCore = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    processStartedAt: PROCESS_STARTED_AT_ISO,
    token: randomUUID(),
  };
  return {
    ...core,
    contentHash: sha256Hex(serializeStorageLockCore(core)),
  };
}

function parseObservedStorageLockState(raw: string): ObservedStorageLockState | null {
  const parsed = safeJsonParse<Record<string, unknown>>(raw);
  if (parsed.ok) {
    const pid = parsed.value.pid;
    const startedAt = parsed.value.startedAt;
    const processStartedAt = parsed.value.processStartedAt;
    const token = parsed.value.token;
    const contentHash = parsed.value.contentHash;
    if (typeof pid === 'number' && Number.isFinite(pid) && typeof startedAt === 'string') {
      const core: StorageProcessLockCore | null =
        typeof processStartedAt === 'string' && typeof token === 'string'
          ? { pid, startedAt, processStartedAt, token }
          : null;
      const contentHashValid = Boolean(
        core
          && typeof contentHash === 'string'
          && contentHash === sha256Hex(serializeStorageLockCore(core))
      );
      return {
        pid,
        startedAt,
        processStartedAt: typeof processStartedAt === 'string' ? processStartedAt : undefined,
        token: typeof token === 'string' ? token : undefined,
        contentHashValid,
      };
    }
  }
  const legacyPid = Number.parseInt(raw.trim(), 10);
  if (Number.isFinite(legacyPid)) {
    return {
      pid: legacyPid,
      startedAt: 'unknown',
      contentHashValid: false,
    };
  }
  return null;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === code);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspectEmbeddingVectorValues(embedding: Float32Array): { normSq: number; hasNonFinite: boolean } {
  let normSq = 0;
  let hasNonFinite = false;
  for (let i = 0; i < embedding.length; i++) {
    const value = embedding[i];
    if (!Number.isFinite(value)) {
      hasNonFinite = true;
      break;
    }
    normSq += value * value;
  }
  return { normSq, hasNonFinite };
}

const LANGUAGE_EXTENSION_MAP: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  csharp: ['.cs'],
  ruby: ['.rb'],
  php: ['.php'],
  swift: ['.swift'],
};

function normalizeSqlPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function isAbsolutePathLike(value: string): boolean {
  const normalized = normalizeSqlPath(value.trim());
  if (!normalized) return false;
  return path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//');
}

function maybeRebaseLegacyAbsolutePath(value: string, legacyWorkspaceRoot: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const normalized = normalizeSqlPath(trimmed);
  if (!isAbsolutePathLike(normalized)) return normalized;

  const normalizedLegacyRoot = normalizeSqlPath(path.resolve(legacyWorkspaceRoot)).replace(/\/+$/, '');
  const lowerValue = normalized.toLowerCase();
  const lowerLegacyRoot = normalizedLegacyRoot.toLowerCase();

  if (lowerValue === lowerLegacyRoot) return normalized;
  const prefix = `${lowerLegacyRoot}/`;
  if (!lowerValue.startsWith(prefix)) return normalized;

  const relative = normalized.slice(normalizedLegacyRoot.length + 1).replace(/^\.\/+/, '');
  return relative.length > 0 ? relative : normalized;
}

function normalizeFilterPathPrefix(prefix: string | undefined, workspaceRoot?: string): string[] {
  if (!prefix || prefix.trim().length === 0) return [];
  const candidates = new Set<string>();
  const raw = normalizeSqlPath(prefix.trim()).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (raw.length > 0) candidates.add(raw.toLowerCase());

  if (workspaceRoot) {
    const absolute = path.isAbsolute(prefix)
      ? path.resolve(prefix)
      : path.resolve(workspaceRoot, prefix);
    const normalizedAbsolute = normalizeSqlPath(absolute).replace(/\/+$/, '');
    if (normalizedAbsolute.length > 0) candidates.add(normalizedAbsolute.toLowerCase());
    const relative = normalizeSqlPath(path.relative(workspaceRoot, absolute)).replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (relative.length > 0 && !relative.startsWith('..')) {
      candidates.add(relative.toLowerCase());
    }
  }

  return Array.from(candidates.values());
}

function normalizeLanguageExtensions(language: string | undefined): string[] {
  if (!language) return [];
  const normalized = language.trim().toLowerCase();
  if (!normalized) return [];
  return LANGUAGE_EXTENSION_MAP[normalized] ?? [];
}

// ============================================================================
// SQL INJECTION PREVENTION
// ============================================================================

/** Allowed column names for ORDER BY clauses. Add new columns as needed. */
const ALLOWED_ORDER_COLUMNS = new Set([
  // Common columns across tables
  'id', 'name', 'confidence', 'created_at', 'updated_at', 'ingested_at',
  'last_verified_at', 'recorded_at', 'timestamp',
  // Function/module specific
  'file_path', 'start_line', 'end_line', 'complexity', 'last_indexed', 'line_count',
  // Directory specific
  'depth', 'total_files',
  // Assessment specific
  'health_score', 'assessed_at', 'entity_path',
  // Context pack specific
  'pack_id', 'pack_type', 'used_at', 'success_count', 'failure_count',
  // Evolution/quality specific
  'score', 'quality_score', 'relevance_score',
  // Graph/relationship specific
  'source', 'target', 'weight', 'source_type', 'source_version',
  // Cochange specific
  'cochange_count', 'change_count', 'strength', 'file_a', 'file_b',
  // Ownership specific
  'author', 'commit_count', 'last_modified',
  // Knowledge specific
  'category', 'subcategory', 'freshness',
  // Universal knowledge specific
  'maintainability_index', 'risk_score', 'test_coverage', 'cyclomatic_complexity',
]);

/** Allowed ORDER BY directions */
const ALLOWED_ORDER_DIRECTIONS = new Set(['asc', 'desc', 'ASC', 'DESC']);

/** Allowed table names for dynamic queries */
const ALLOWED_TABLES = new Set([
  'librarian_functions', 'librarian_modules', 'librarian_context_packs',
  'librarian_graph_edges', 'librarian_embeddings', 'librarian_multi_vectors',
  'librarian_snippets', 'librarian_ingested_items', 'librarian_query_cache',
  'librarian_evolution_outcomes', 'librarian_quality_history', 'librarian_test_mappings',
  'librarian_commits', 'librarian_cochange', 'librarian_ownership',
  'librarian_confidence_events', 'librarian_universal_knowledge',
  'librarian_files', 'librarian_directories', 'librarian_assessments',
  'librarian_graph_metrics', 'librarian_evidence',
]);

/**
 * Sanitize a string for safe inclusion in error messages.
 * Removes control characters and truncates to prevent log injection.
 */
function sanitizeForError(input: unknown): string {
  const str = String(input);
  return str.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 100);
}

/**
 * Validate and return safe ORDER BY column name.
 * Throws if column is not in allowlist.
 */
function validateOrderColumn(column: unknown): string {
  if (typeof column !== 'string') {
    throw new Error(`Invalid ORDER BY column type: expected string, got ${typeof column}`);
  }
  if (!ALLOWED_ORDER_COLUMNS.has(column)) {
    // Don't expose full allowlist in error message to prevent schema enumeration
    throw new Error(`Invalid ORDER BY column: ${sanitizeForError(column)}`);
  }
  return column;
}

/**
 * Validate and return safe ORDER BY direction.
 * Returns lowercase 'asc' or 'desc'.
 */
function validateOrderDirection(direction: unknown): 'asc' | 'desc' {
  if (typeof direction !== 'string') {
    throw new Error(`Invalid ORDER BY direction type: expected string, got ${typeof direction}`);
  }
  const lower = direction.toLowerCase();
  if (lower !== 'asc' && lower !== 'desc') {
    throw new Error(`Invalid ORDER BY direction: ${sanitizeForError(direction)}. Allowed: asc, desc`);
  }
  return lower;
}

/**
 * Validate table name for dynamic queries.
 * Throws if table is not in allowlist.
 */
function validateTableName(table: unknown): string {
  if (typeof table !== 'string') {
    throw new Error(`Invalid table name type: expected string, got ${typeof table}`);
  }
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${sanitizeForError(table)}`);
  }
  return table;
}

// ============================================================================
// SQLITE STORAGE IMPLEMENTATION
// ============================================================================

export class SqliteLiBrainianStorage implements LiBrainianStorage {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly lockPath: string;
  private readonly usesProcessLock: boolean;
  private releaseLock: (() => Promise<void>) | null = null;
  private transactionChain: Promise<void> = Promise.resolve();
  private readonly workspaceRoot?: string;
  private initialized = false;
  private vectorIndex: VectorIndex | null = null;
  private vectorIndexDirty = true;
  private redactionTotals: RedactionCounts;
  private readonly indexCoordinationRowId = 1;

  constructor(dbPath: string, workspaceRoot?: string) {
    this.dbPath = dbPath;
    this.lockPath = `${dbPath}.lock`;
    this.usesProcessLock = dbPath !== ':memory:';
    this.workspaceRoot = workspaceRoot;
    this.redactionTotals = createEmptyRedactionCounts();
  }

  private async readObservedLockState(): Promise<ObservedStorageLockState | null> {
    try {
      const raw = await fs.readFile(this.lockPath, 'utf8');
      return parseObservedStorageLockState(raw);
    } catch (error) {
      if (isErrno(error, 'ENOENT') || isErrno(error, 'EISDIR')) return null;
      throw error;
    }
  }

  private async releaseProcessLock(expected: StorageProcessLockState): Promise<void> {
    const observed = await this.readObservedLockState();
    if (!observed) {
      return;
    }
    if (
      observed.pid !== expected.pid
      || observed.startedAt !== expected.startedAt
      || observed.token !== expected.token
    ) {
      return;
    }
    try {
      await fs.unlink(this.lockPath);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
    }
  }

  private async acquireProcessLock(): Promise<void> {
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      const state = createStorageProcessLockState();
      try {
        await fs.writeFile(this.lockPath, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' });
        this.releaseLock = async () => this.releaseProcessLock(state);
        return;
      } catch (error) {
        if (!isErrno(error, 'EEXIST') && !isErrno(error, 'EISDIR')) {
          throw error;
        }
      }

      const observed = await this.readObservedLockState();
      if (observed && isPidAlive(observed.pid)) {
        throw new Error(`indexing in progress (pid=${observed.pid}, startedAt=${observed.startedAt})`);
      }

      const recovery = await attemptStorageRecovery(this.dbPath).catch((recoveryError) => ({
        recovered: false,
        actions: [] as string[],
        errors: [String(recoveryError)],
      }));
      if (recovery.recovered) {
        logWarning('Recovered stale storage lock state; retrying lock acquisition', {
          path: this.lockPath,
          actions: recovery.actions,
        });
        continue;
      }

      await sleep(LOCK_RETRY_INTERVAL_MS);
    }

    const observed = await this.readObservedLockState();
    if (observed && isPidAlive(observed.pid)) {
      throw new Error(`indexing in progress (pid=${observed.pid}, startedAt=${observed.startedAt})`);
    }
    throw new Error('storage lock acquisition timed out');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.usesProcessLock) {
      await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
      await fs.writeFile(this.dbPath, '', { flag: 'a' });

      // Proactively clear stale lock artifacts from prior interrupted runs.
      try {
        const proactiveRecovery = await attemptStorageRecovery(this.dbPath);
        if (proactiveRecovery.recovered) {
          logWarning('Recovered stale lock state before acquisition', {
            path: this.lockPath,
            actions: proactiveRecovery.actions,
          });
        }
      } catch (checkError) {
        // Recovery check failed; direct acquisition path still handles stale locks.
        logWarning('Proactive lock recovery check failed, proceeding with acquisition', {
          path: this.lockPath,
          error: checkError instanceof Error ? checkError.message : String(checkError),
        });
      }

      try {
        await this.acquireProcessLock();
      } catch (error) {
        const recovery = await attemptStorageRecovery(this.dbPath, { error }).catch((recoveryError) => ({
          recovered: false,
          actions: [] as string[],
          errors: [String(recoveryError)],
        }));
        if (!recovery.recovered) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`unverified_by_trace:storage_locked:${message}`);
        }
        logWarning('Recovered storage lock state; retrying lock acquisition', {
          path: this.lockPath,
          actions: recovery.actions,
        });
        try {
          await this.acquireProcessLock();
        } catch (retryError) {
          const message = retryError instanceof Error ? retryError.message : String(retryError);
          throw new Error(`unverified_by_trace:storage_locked:${message}`);
        }
      }
    }

    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');

      await applyMigrations(this.db, this.workspaceRoot);
      this.ensureEmbeddingColumns();
      this.ensureGraphTables();
      this.ensureTemporalTables();
      this.ensureEvidenceTables();
      this.ensureEvidenceColumns();
      this.ensureEvolutionTables();
      this.ensureIndexCoordinationTables();
      this.ensureConfidenceColumns();
      this.ensureFunctionBehaviorColumns();
      this.ensureContextPackOutcomeColumns();
      this.ensureContextPackVersioningColumns();
      this.ensureConfidenceEventColumns();
      this.ensureUniversalKnowledgeTable();
      this.ensureFileKnowledgeTable();
      this.ensureDirectoryKnowledgeTable();
      this.ensureAssessmentTable();
      this.ensureAdvancedAnalysisTables();
      this.ensureAdvancedLibraryFeaturesTables();
      this.rebindWorkspacePathsIfNeeded();

      this.initialized = true;
    } catch (error) {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      if (this.releaseLock) {
        await this.releaseLock().catch((lockError) => {
          logWarning('Failed to release lock during initialization cleanup', { path: this.lockPath, error: lockError });
        });
        this.releaseLock = null;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    } finally {
      this.initialized = false;
      if (this.releaseLock) {
        await this.releaseLock().catch((lockError) => {
          logWarning('Failed to release lock during close', { path: this.lockPath, error: lockError });
        });
        this.releaseLock = null;
      }
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): StorageCapabilities {
    return {
      core: {
        getFunctions: true,
        getFiles: true,
        getContextPacks: true,
      },
      optional: {
        graphMetrics: true,
        multiVectors: true,
        embeddings: true,
        episodes: true,
        verificationPlans: true,
      },
      versions: {
        schema: 1,
        api: 1,
      },
    };
  }

  private ensureDb(): Database.Database {
    if (!this.db) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this.db;
  }

  private hasTable(tableName: string): boolean {
    if (!this.db) return false;
    const row = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    return Boolean(row);
  }

  private rebindWorkspacePathsIfNeeded(): void {
    if (!this.db || !this.workspaceRoot || !this.hasTable('librarian_metadata')) return;
    const db = this.db;
    const currentWorkspace = path.resolve(this.workspaceRoot);

    const metadataRow = db
      .prepare('SELECT value FROM librarian_metadata WHERE key = ?')
      .get('metadata') as { value?: string } | undefined;
    if (!metadataRow?.value) return;

    const metadata = parseJsonOrNull<Record<string, unknown>>(metadataRow.value);
    const previousWorkspaceRaw = typeof metadata?.workspace === 'string' ? metadata.workspace.trim() : '';
    if (!previousWorkspaceRaw) return;

    const previousWorkspace = path.resolve(previousWorkspaceRaw);
    const previousNormalized = normalizeSqlPath(previousWorkspace).replace(/\/+$/, '');
    const currentNormalized = normalizeSqlPath(currentWorkspace).replace(/\/+$/, '');
    if (previousNormalized === currentNormalized) return;

    let columnUpdates = 0;
    let contextPackUpdates = 0;
    let parseWarnings = 0;
    let watchStateUpdated = false;
    let bootstrapWorkspaceRows = 0;

    const rebindPathColumn = (table: string, column: string): number => {
      if (!this.hasTable(table)) return 0;
      const tableId = quoteIdentifier(table);
      const columnId = quoteIdentifier(column);
      const rows = db
        .prepare(`SELECT rowid as rowid, ${columnId} as value FROM ${tableId}`)
        .all() as Array<{ rowid: number; value: unknown }>;
      const update = db.prepare(`UPDATE ${tableId} SET ${columnId} = ? WHERE rowid = ?`);
      let changed = 0;
      for (const row of rows) {
        if (typeof row.value !== 'string' || row.value.length === 0) continue;
        const rebased = maybeRebaseLegacyAbsolutePath(row.value, previousWorkspace);
        if (rebased !== row.value) {
          update.run(rebased, row.rowid);
          changed += 1;
        }
      }
      return changed;
    };

    const transactional = db.transaction(() => {
      const pathColumns: Array<{ table: string; column: string }> = [
        { table: 'librarian_functions', column: 'file_path' },
        { table: 'librarian_modules', column: 'path' },
        { table: 'librarian_files', column: 'path' },
        { table: 'librarian_files', column: 'relative_path' },
        { table: 'librarian_files', column: 'directory' },
        { table: 'librarian_file_checksums', column: 'file_path' },
        { table: 'librarian_graph_edges', column: 'source_file' },
        { table: 'librarian_test_mapping', column: 'test_path' },
        { table: 'librarian_test_mapping', column: 'source_path' },
        { table: 'librarian_ownership', column: 'file_path' },
        { table: 'librarian_assessments', column: 'entity_path' },
      ];
      for (const target of pathColumns) {
        columnUpdates += rebindPathColumn(target.table, target.column);
      }

      if (this.hasTable('librarian_context_packs')) {
        const rows = db
          .prepare('SELECT rowid as rowid, related_files, code_snippets, invalidation_triggers FROM librarian_context_packs')
          .all() as Array<{
            rowid: number;
            related_files: string;
            code_snippets: string;
            invalidation_triggers: string;
          }>;
        const update = db.prepare(
          'UPDATE librarian_context_packs SET related_files = ?, code_snippets = ?, invalidation_triggers = ? WHERE rowid = ?'
        );

        for (const row of rows) {
          let nextRelated = row.related_files;
          let nextSnippets = row.code_snippets;
          let nextTriggers = row.invalidation_triggers;
          let changed = false;

          const related = parseJsonOrNull<unknown[]>(row.related_files);
          if (Array.isArray(related)) {
            const rebased = related.map((item) =>
              typeof item === 'string' ? maybeRebaseLegacyAbsolutePath(item, previousWorkspace) : item
            );
            const serialized = JSON.stringify(rebased);
            if (serialized !== row.related_files) {
              nextRelated = serialized;
              changed = true;
            }
          } else {
            parseWarnings += 1;
          }

          const snippets = parseJsonOrNull<unknown[]>(row.code_snippets);
          if (Array.isArray(snippets)) {
            const rebased = snippets.map((item) => {
              if (!item || typeof item !== 'object') return item;
              const snippet = item as Record<string, unknown>;
              if (typeof snippet.filePath !== 'string') return item;
              const nextPath = maybeRebaseLegacyAbsolutePath(snippet.filePath, previousWorkspace);
              if (nextPath === snippet.filePath) return item;
              return { ...snippet, filePath: nextPath };
            });
            const serialized = JSON.stringify(rebased);
            if (serialized !== row.code_snippets) {
              nextSnippets = serialized;
              changed = true;
            }
          } else {
            parseWarnings += 1;
          }

          const triggers = parseJsonOrNull<unknown[]>(row.invalidation_triggers);
          if (Array.isArray(triggers)) {
            const rebased = triggers.map((item) =>
              typeof item === 'string' ? maybeRebaseLegacyAbsolutePath(item, previousWorkspace) : item
            );
            const serialized = JSON.stringify(rebased);
            if (serialized !== row.invalidation_triggers) {
              nextTriggers = serialized;
              changed = true;
            }
          } else {
            parseWarnings += 1;
          }

          if (changed) {
            update.run(nextRelated, nextSnippets, nextTriggers, row.rowid);
            contextPackUpdates += 1;
          }
        }
      }

      const watchStateRow = db
        .prepare('SELECT value FROM librarian_metadata WHERE key = ?')
        .get('watch_state') as { value?: string } | undefined;
      if (watchStateRow?.value) {
        const watchStateParsed = safeJsonParse<Record<string, unknown>>(watchStateRow.value);
        if (watchStateParsed.ok) {
          const next = {
            ...watchStateParsed.value,
            workspace_root: currentWorkspace,
          };
          db.prepare('INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)')
            .run('watch_state', JSON.stringify(next));
          watchStateUpdated = true;
        } else {
          parseWarnings += 1;
        }
      }

      if (this.hasTable('librarian_bootstrap_history')) {
        bootstrapWorkspaceRows = db
          .prepare('UPDATE librarian_bootstrap_history SET workspace = ? WHERE workspace = ?')
          .run(currentWorkspace, previousWorkspace).changes;
      }

      const nextMetadata = {
        ...(metadata ?? {}),
        workspace: currentWorkspace,
      };
      db.prepare('INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)')
        .run('metadata', JSON.stringify(nextMetadata));
      db.prepare('INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)')
        .run(
          'workspace_rebind',
          JSON.stringify({
            from: previousWorkspace,
            to: currentWorkspace,
            reboundAt: new Date().toISOString(),
            pathColumnUpdates: columnUpdates,
            contextPackUpdates,
            watchStateUpdated,
            bootstrapWorkspaceRows,
            parseWarnings,
          })
        );
    });

    transactional();

    logWarning('[librarian] Rebound workspace paths after index relocation', {
      from: previousWorkspace,
      to: currentWorkspace,
      pathColumnUpdates: columnUpdates,
      contextPackUpdates,
      watchStateUpdated,
      bootstrapWorkspaceRows,
      parseWarnings,
    });
  }

  private ensureEmbeddingColumns(): void {
    if (!this.db) return;
    const columns = this.db
      .prepare('PRAGMA table_info(librarian_embeddings)')
      .all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));

    if (!names.has('generated_at')) {
      this.db
        .prepare('ALTER TABLE librarian_embeddings ADD COLUMN generated_at TEXT NOT NULL DEFAULT ""')
        .run();
      if (names.has('created_at')) {
        this.db
          .prepare('UPDATE librarian_embeddings SET generated_at = created_at WHERE generated_at = ""')
          .run();
      } else {
        this.db
          .prepare('UPDATE librarian_embeddings SET generated_at = ? WHERE generated_at = ""')
          .run(new Date().toISOString());
      }
    }

    if (!names.has('token_count')) {
      this.db
        .prepare('ALTER TABLE librarian_embeddings ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0')
        .run();
    }
  }

  private ensureGraphTables(): void {
    if (!this.db) return;
    this.db.exec('CREATE TABLE IF NOT EXISTS librarian_graph_metrics (entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, pagerank REAL NOT NULL, betweenness REAL NOT NULL, closeness REAL NOT NULL, eigenvector REAL NOT NULL, community_id INTEGER NOT NULL, is_bridge INTEGER NOT NULL, computed_at TEXT NOT NULL, PRIMARY KEY (entity_id, entity_type)); CREATE INDEX IF NOT EXISTS idx_graph_metrics_type ON librarian_graph_metrics(entity_type); CREATE INDEX IF NOT EXISTS idx_graph_metrics_community ON librarian_graph_metrics(community_id);');
    this.db.exec('CREATE TABLE IF NOT EXISTS librarian_graph_edges (from_id TEXT NOT NULL, from_type TEXT NOT NULL, to_id TEXT NOT NULL, to_type TEXT NOT NULL, edge_type TEXT NOT NULL, source_file TEXT NOT NULL, source_line INTEGER, confidence REAL NOT NULL, computed_at TEXT NOT NULL, PRIMARY KEY (from_id, to_id, edge_type, source_file)); CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON librarian_graph_edges(from_id); CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON librarian_graph_edges(to_id); CREATE INDEX IF NOT EXISTS idx_graph_edges_file ON librarian_graph_edges(source_file); CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON librarian_graph_edges(edge_type, from_type);');
  }

  private ensureTemporalTables(): void {
    if (!this.db) return;
    this.db.exec('CREATE TABLE IF NOT EXISTS librarian_cochange (file_a TEXT NOT NULL, file_b TEXT NOT NULL, change_count INTEGER NOT NULL, total_changes INTEGER NOT NULL, strength REAL NOT NULL, computed_at TEXT NOT NULL, PRIMARY KEY (file_a, file_b)); CREATE INDEX IF NOT EXISTS idx_cochange_strength ON librarian_cochange(strength DESC); CREATE INDEX IF NOT EXISTS idx_cochange_file_a ON librarian_cochange(file_a);');
    this.db.exec('CREATE TABLE IF NOT EXISTS librarian_confidence_events (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, delta REAL NOT NULL, updated_at TEXT NOT NULL, reason TEXT); CREATE INDEX IF NOT EXISTS idx_confidence_events_entity ON librarian_confidence_events(entity_id, entity_type); CREATE INDEX IF NOT EXISTS idx_confidence_events_time ON librarian_confidence_events(updated_at);');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retrieval_confidence_log (
        id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        retrieval_entropy REAL NOT NULL,
        returned_pack_ids TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        intent TEXT,
        from_depth TEXT,
        to_depth TEXT,
        escalation_reason TEXT,
        attempt INTEGER,
        max_escalation_depth INTEGER,
        routed_strategy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_retrieval_confidence_log_query_hash ON retrieval_confidence_log(query_hash);
      CREATE INDEX IF NOT EXISTS idx_retrieval_confidence_log_timestamp ON retrieval_confidence_log(timestamp DESC);

      CREATE TABLE IF NOT EXISTS retrieval_strategy_rewards (
        strategy_id TEXT NOT NULL,
        intent_type TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL,
        PRIMARY KEY (strategy_id, intent_type)
      );
      CREATE INDEX IF NOT EXISTS idx_retrieval_strategy_rewards_intent ON retrieval_strategy_rewards(intent_type);

      CREATE TABLE IF NOT EXISTS retrieval_strategy_queries (
        query_id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        intent_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        feedback_outcome TEXT,
        feedback_recorded_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_retrieval_strategy_queries_intent ON retrieval_strategy_queries(intent_type);
      CREATE INDEX IF NOT EXISTS idx_retrieval_strategy_queries_strategy ON retrieval_strategy_queries(strategy_id);

      CREATE TABLE IF NOT EXISTS query_access_log (
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        last_queried_at TEXT NOT NULL,
        query_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entity_id, entity_type)
      );
      CREATE INDEX IF NOT EXISTS idx_query_access_log_entity_type ON query_access_log(entity_type);
      CREATE INDEX IF NOT EXISTS idx_query_access_log_last_queried ON query_access_log(last_queried_at DESC);
    `);
  }

  private ensureEvidenceTables(): void {
    if (!this.db) return;
    this.db.exec('CREATE TABLE IF NOT EXISTS librarian_evidence (claim_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, file_path TEXT NOT NULL, line_start INTEGER NOT NULL, line_end INTEGER, snippet TEXT NOT NULL, claim TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT "", verified_at TEXT, is_stale INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_evidence_entity ON librarian_evidence(entity_id, entity_type);');
  }

  private ensureEvidenceColumns(): void {
    const db = this.db;
    if (!db) return;
    const columns = db.prepare('PRAGMA table_info(librarian_evidence)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('content_hash')) {
      db.prepare('ALTER TABLE librarian_evidence ADD COLUMN content_hash TEXT NOT NULL DEFAULT ""').run();
    }
    if (!names.has('verified_at')) {
      db.prepare('ALTER TABLE librarian_evidence ADD COLUMN verified_at TEXT').run();
    }
    if (!names.has('is_stale')) {
      db.prepare('ALTER TABLE librarian_evidence ADD COLUMN is_stale INTEGER NOT NULL DEFAULT 0').run();
    }
    db.prepare('CREATE INDEX IF NOT EXISTS idx_evidence_stale ON librarian_evidence(is_stale)').run();
  }

  private ensureEvolutionTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_evolution_outcomes (
        task_id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        quality_score REAL NOT NULL,
        files_changed TEXT NOT NULL,
        tests_added INTEGER NOT NULL,
        tests_pass INTEGER NOT NULL,
        librarian_context_used INTEGER NOT NULL,
        context_pack_count INTEGER NOT NULL,
        decomposed INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evolution_agent ON librarian_evolution_outcomes(agent_id);
      CREATE INDEX IF NOT EXISTS idx_evolution_timestamp ON librarian_evolution_outcomes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_evolution_success ON librarian_evolution_outcomes(success);

      CREATE TABLE IF NOT EXISTS librarian_learned_missing (
        context TEXT NOT NULL,
        task_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (context, task_id)
      );
      CREATE INDEX IF NOT EXISTS idx_learned_missing_context ON librarian_learned_missing(context);

      CREATE TABLE IF NOT EXISTS librarian_quality_history (
        id TEXT PRIMARY KEY,
        overall INTEGER NOT NULL,
        maintainability INTEGER NOT NULL,
        testability INTEGER NOT NULL,
        readability INTEGER NOT NULL,
        complexity INTEGER NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quality_history_date ON librarian_quality_history(recorded_at DESC);
    `);
  }

  private ensureIndexCoordinationTables(): void {
    const db = this.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_index_coordination (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS librarian_change_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        path TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_change_log_version ON librarian_change_log(version);
      CREATE INDEX IF NOT EXISTS idx_change_log_path ON librarian_change_log(path);
      CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON librarian_change_log(created_at);
    `);
    db.prepare(`
      INSERT OR IGNORE INTO librarian_index_coordination (singleton, version)
      VALUES (1, 0)
    `).run();
  }

  private ensureConfidenceColumns(): void {
    const db = this.db;
    if (!db) return;
    const addColumnIfMissing = (table: string): void => {
      // Validate table name to prevent SQL injection
      const validTable = validateTableName(table);
      const columns = db.prepare(`PRAGMA table_info(${validTable})`).all() as { name: string }[];
      const names = new Set(columns.map((column) => column.name));
      if (!names.has('last_verified_at')) db.prepare(`ALTER TABLE ${validTable} ADD COLUMN last_verified_at TEXT`).run();
    };
    addColumnIfMissing('librarian_functions');
    addColumnIfMissing('librarian_modules');
    addColumnIfMissing('librarian_context_packs');
  }

  private ensureFunctionBehaviorColumns(): void {
    const db = this.db;
    if (!db) return;
    const columns = db.prepare('PRAGMA table_info(librarian_functions)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('is_pure')) {
      db.prepare('ALTER TABLE librarian_functions ADD COLUMN is_pure INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!names.has('has_side_effects')) {
      db.prepare('ALTER TABLE librarian_functions ADD COLUMN has_side_effects INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!names.has('modifies_params')) {
      db.prepare('ALTER TABLE librarian_functions ADD COLUMN modifies_params INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!names.has('throws')) {
      db.prepare('ALTER TABLE librarian_functions ADD COLUMN throws INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!names.has('return_depends_on_inputs')) {
      db.prepare('ALTER TABLE librarian_functions ADD COLUMN return_depends_on_inputs INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!names.has('effect_signature')) {
      db.prepare('ALTER TABLE librarian_functions ADD COLUMN effect_signature TEXT NOT NULL DEFAULT \'[]\'').run();
    }
    db.prepare('CREATE INDEX IF NOT EXISTS idx_functions_is_pure ON librarian_functions(is_pure)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_functions_side_effects ON librarian_functions(has_side_effects)').run();
  }

  private ensureContextPackOutcomeColumns(): void {
    const db = this.db;
    if (!db) return;
    const columns = db.prepare('PRAGMA table_info(librarian_context_packs)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('success_count')) {
      db.prepare('ALTER TABLE librarian_context_packs ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!names.has('failure_count')) {
      db.prepare('ALTER TABLE librarian_context_packs ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0').run();
    }
  }

  private ensureContextPackVersioningColumns(): void {
    const db = this.db;
    if (!db) return;
    const columns = db.prepare('PRAGMA table_info(librarian_context_packs)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('content_hash')) {
      db.prepare("ALTER TABLE librarian_context_packs ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''").run();
      db.prepare(`
        UPDATE librarian_context_packs
        SET content_hash = substr(pack_id || ':' || target_id || ':' || pack_type, 1, 128)
        WHERE content_hash = ''
      `).run();
    }
    if (!names.has('schema_version')) {
      db.prepare('ALTER TABLE librarian_context_packs ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1').run();
    }
  }

  private ensureConfidenceEventColumns(): void {
    const db = this.db;
    if (!db) return;
    const columns = db.prepare('PRAGMA table_info(librarian_confidence_events)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('reason')) {
      db.prepare('ALTER TABLE librarian_confidence_events ADD COLUMN reason TEXT').run();
    }
  }

  private ensureUniversalKnowledgeTable(): void {
    const db = this.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_universal_knowledge (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        knowledge TEXT NOT NULL,
        purpose_summary TEXT,
        maintainability_index REAL,
        risk_score REAL,
        test_coverage REAL,
        cyclomatic_complexity INTEGER,
        cognitive_complexity TEXT,
        embedding BLOB,
        confidence REAL NOT NULL,
        generated_at TEXT NOT NULL,
        valid_until TEXT,
        hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uk_file ON librarian_universal_knowledge(file);
      CREATE INDEX IF NOT EXISTS idx_uk_kind ON librarian_universal_knowledge(kind);
      CREATE INDEX IF NOT EXISTS idx_uk_maintainability ON librarian_universal_knowledge(maintainability_index);
      CREATE INDEX IF NOT EXISTS idx_uk_risk ON librarian_universal_knowledge(risk_score);
      CREATE INDEX IF NOT EXISTS idx_uk_coverage ON librarian_universal_knowledge(test_coverage);
      CREATE INDEX IF NOT EXISTS idx_uk_confidence ON librarian_universal_knowledge(confidence);
      CREATE INDEX IF NOT EXISTS idx_uk_hash ON librarian_universal_knowledge(hash);
    `);
  }

  private ensureFileKnowledgeTable(): void {
    const db = this.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        relative_path TEXT NOT NULL,
        name TEXT NOT NULL,
        extension TEXT NOT NULL,
        category TEXT NOT NULL,
        purpose TEXT NOT NULL,
        role TEXT NOT NULL,
        summary TEXT NOT NULL,
        key_exports TEXT NOT NULL,
        main_concepts TEXT NOT NULL,
        line_count INTEGER NOT NULL,
        function_count INTEGER NOT NULL,
        class_count INTEGER NOT NULL,
        import_count INTEGER NOT NULL,
        export_count INTEGER NOT NULL,
        imports TEXT NOT NULL,
        imported_by TEXT NOT NULL,
        directory TEXT NOT NULL,
        complexity TEXT NOT NULL,
        test_coverage REAL,
        has_tests INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        confidence REAL NOT NULL,
        last_indexed TEXT NOT NULL,
        last_modified TEXT NOT NULL,
        llm_evidence TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_path ON librarian_files(path);
      CREATE INDEX IF NOT EXISTS idx_files_directory ON librarian_files(directory);
      CREATE INDEX IF NOT EXISTS idx_files_category ON librarian_files(category);
      CREATE INDEX IF NOT EXISTS idx_files_extension ON librarian_files(extension);
      CREATE INDEX IF NOT EXISTS idx_files_checksum ON librarian_files(checksum);
      CREATE INDEX IF NOT EXISTS idx_files_confidence ON librarian_files(confidence);
    `);
  }

  private ensureDirectoryKnowledgeTable(): void {
    const db = this.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_directories (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        relative_path TEXT NOT NULL,
        name TEXT NOT NULL,
        fingerprint TEXT NOT NULL DEFAULT "",
        purpose TEXT NOT NULL,
        role TEXT NOT NULL,
        description TEXT NOT NULL,
        bounded_context TEXT,
        pattern TEXT NOT NULL,
        depth INTEGER NOT NULL,
        file_count INTEGER NOT NULL,
        subdirectory_count INTEGER NOT NULL,
        total_files INTEGER NOT NULL,
        main_files TEXT NOT NULL,
        subdirectories TEXT NOT NULL,
        file_types TEXT NOT NULL,
        parent TEXT,
        siblings TEXT NOT NULL,
        related_directories TEXT NOT NULL,
        has_readme INTEGER NOT NULL,
        has_index INTEGER NOT NULL,
        has_tests INTEGER NOT NULL,
        complexity TEXT NOT NULL,
        confidence REAL NOT NULL,
        last_indexed TEXT NOT NULL,
        llm_evidence TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dirs_path ON librarian_directories(path);
      CREATE INDEX IF NOT EXISTS idx_dirs_parent ON librarian_directories(parent);
      CREATE INDEX IF NOT EXISTS idx_dirs_role ON librarian_directories(role);
      CREATE INDEX IF NOT EXISTS idx_dirs_depth ON librarian_directories(depth);
      CREATE INDEX IF NOT EXISTS idx_dirs_confidence ON librarian_directories(confidence);
    `);

    const columns = db.prepare('PRAGMA table_info(librarian_directories)').all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('fingerprint')) {
      db.prepare('ALTER TABLE librarian_directories ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ""').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_dirs_fingerprint ON librarian_directories(fingerprint)').run();
    }
    if (!names.has('llm_evidence')) {
      db.prepare('ALTER TABLE librarian_directories ADD COLUMN llm_evidence TEXT DEFAULT NULL').run();
    }

    // Also migrate librarian_files table
    const fileColumns = db.prepare('PRAGMA table_info(librarian_files)').all() as { name: string }[];
    const fileNames = new Set(fileColumns.map((column) => column.name));
    if (!fileNames.has('llm_evidence')) {
      db.prepare('ALTER TABLE librarian_files ADD COLUMN llm_evidence TEXT DEFAULT NULL').run();
    }
  }

  private ensureAssessmentTable(): void {
    if (!this.db) return;
    // Flash assessments table - at-a-glance health checks for files and directories
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_assessments (
        entity_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_path TEXT NOT NULL,
        findings TEXT NOT NULL,
        overall_health TEXT NOT NULL,
        health_score REAL NOT NULL,
        quick_summary TEXT NOT NULL,
        assessed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assess_path ON librarian_assessments(entity_path);
      CREATE INDEX IF NOT EXISTS idx_assess_type ON librarian_assessments(entity_type);
      CREATE INDEX IF NOT EXISTS idx_assess_health ON librarian_assessments(overall_health);
      CREATE INDEX IF NOT EXISTS idx_assess_score ON librarian_assessments(health_score);
    `);
  }

  private ensureAdvancedAnalysisTables(): void {
    if (!this.db) return;
    // Tables created by migration 010, but ensure they exist for backwards compatibility
    this.db.exec(`
      -- Strongly Connected Components
      CREATE TABLE IF NOT EXISTS librarian_scc (
        component_id INTEGER NOT NULL,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        is_root INTEGER NOT NULL DEFAULT 0,
        component_size INTEGER NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (entity_id, entity_type)
      );
      CREATE INDEX IF NOT EXISTS idx_scc_component ON librarian_scc(component_id);
      CREATE INDEX IF NOT EXISTS idx_scc_size ON librarian_scc(component_size DESC);

      -- Control Flow Graph edges
      CREATE TABLE IF NOT EXISTS librarian_cfg_edges (
        function_id TEXT NOT NULL,
        from_block INTEGER NOT NULL,
        to_block INTEGER NOT NULL,
        edge_type TEXT NOT NULL,
        condition TEXT,
        source_line INTEGER,
        confidence REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (function_id, from_block, to_block, edge_type)
      );
      CREATE INDEX IF NOT EXISTS idx_cfg_function ON librarian_cfg_edges(function_id);

      -- Bayesian confidence tracking
      CREATE TABLE IF NOT EXISTS librarian_bayesian_confidence (
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        prior_alpha REAL NOT NULL DEFAULT 1.0,
        prior_beta REAL NOT NULL DEFAULT 1.0,
        posterior_alpha REAL NOT NULL DEFAULT 1.0,
        posterior_beta REAL NOT NULL DEFAULT 1.0,
        observation_count INTEGER NOT NULL DEFAULT 0,
        last_observation TEXT,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (entity_id, entity_type)
      );
      CREATE INDEX IF NOT EXISTS idx_bayesian_type ON librarian_bayesian_confidence(entity_type);

      -- Stability metrics
      CREATE TABLE IF NOT EXISTS librarian_stability_metrics (
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        volatility REAL NOT NULL,
        trend REAL NOT NULL,
        mean_reversion_rate REAL,
        half_life_days REAL,
        seasonality_period_days INTEGER,
        last_change_delta REAL,
        computed_at TEXT NOT NULL,
        window_days INTEGER NOT NULL DEFAULT 30,
        PRIMARY KEY (entity_id, entity_type)
      );
      CREATE INDEX IF NOT EXISTS idx_stability_volatility ON librarian_stability_metrics(volatility DESC);

      -- Feedback loops
      CREATE TABLE IF NOT EXISTS librarian_feedback_loops (
        loop_id TEXT PRIMARY KEY,
        loop_type TEXT NOT NULL,
        entities TEXT NOT NULL,
        severity TEXT NOT NULL,
        is_stable INTEGER NOT NULL,
        cycle_length INTEGER NOT NULL,
        detected_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution_method TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_loops_severity ON librarian_feedback_loops(severity);

      -- Graph analysis cache
      CREATE TABLE IF NOT EXISTS librarian_graph_cache (
        cache_key TEXT PRIMARY KEY,
        analysis_type TEXT NOT NULL,
        result TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        edge_count INTEGER NOT NULL,
        computation_ms INTEGER NOT NULL,
        computed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_graph_cache_expires ON librarian_graph_cache(expires_at);
    `);
  }

  /**
   * Migration 011: Advanced Library Features
   * Based on 2025-2026 software engineering research
   */
  private ensureAdvancedLibraryFeaturesTables(): void {
    if (!this.db) return;
    this.db.exec(`
      -- Git blame entries (line-level ownership)
      CREATE TABLE IF NOT EXISTS librarian_blame_entries (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        author TEXT NOT NULL,
        author_email TEXT,
        commit_hash TEXT NOT NULL,
        commit_date TEXT NOT NULL,
        original_line INTEGER,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_blame_file ON librarian_blame_entries(file_path);
      CREATE INDEX IF NOT EXISTS idx_blame_author ON librarian_blame_entries(author);
      CREATE INDEX IF NOT EXISTS idx_blame_commit ON librarian_blame_entries(commit_hash);

      -- Git diff records (semantic change tracking)
      CREATE TABLE IF NOT EXISTS librarian_diff_records (
        id TEXT PRIMARY KEY,
        commit_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        additions INTEGER NOT NULL,
        deletions INTEGER NOT NULL,
        hunk_count INTEGER NOT NULL,
        hunks TEXT NOT NULL,
        change_category TEXT NOT NULL,
        complexity REAL NOT NULL,
        impact_score REAL NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_diff_commit ON librarian_diff_records(commit_hash);
      CREATE INDEX IF NOT EXISTS idx_diff_file ON librarian_diff_records(file_path);
      CREATE INDEX IF NOT EXISTS idx_diff_category ON librarian_diff_records(change_category);

      -- Git reflog entries (branch history)
      CREATE TABLE IF NOT EXISTS librarian_reflog_entries (
        id TEXT PRIMARY KEY,
        ref_name TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        previous_commit TEXT,
        timestamp TEXT NOT NULL,
        message TEXT,
        author TEXT,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reflog_ref ON librarian_reflog_entries(ref_name);
      CREATE INDEX IF NOT EXISTS idx_reflog_action ON librarian_reflog_entries(action);
      CREATE INDEX IF NOT EXISTS idx_reflog_time ON librarian_reflog_entries(timestamp DESC);

      -- Code clone entries
      CREATE TABLE IF NOT EXISTS librarian_clone_entries (
        clone_group_id INTEGER NOT NULL,
        entity_id_1 TEXT NOT NULL,
        entity_id_2 TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        similarity REAL NOT NULL,
        clone_type TEXT NOT NULL,
        shared_lines INTEGER,
        shared_tokens INTEGER,
        refactoring_potential REAL NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (entity_id_1, entity_id_2)
      );
      CREATE INDEX IF NOT EXISTS idx_clone_group ON librarian_clone_entries(clone_group_id);
      CREATE INDEX IF NOT EXISTS idx_clone_type ON librarian_clone_entries(clone_type);
      CREATE INDEX IF NOT EXISTS idx_clone_similarity ON librarian_clone_entries(similarity DESC);

      -- Technical debt metrics
      CREATE TABLE IF NOT EXISTS librarian_debt_metrics (
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        total_debt REAL NOT NULL,
        complexity_debt REAL NOT NULL DEFAULT 0,
        duplication_debt REAL NOT NULL DEFAULT 0,
        coupling_debt REAL NOT NULL DEFAULT 0,
        coverage_debt REAL NOT NULL DEFAULT 0,
        architecture_debt REAL NOT NULL DEFAULT 0,
        churn_debt REAL NOT NULL DEFAULT 0,
        documentation_debt REAL NOT NULL DEFAULT 0,
        security_debt REAL NOT NULL DEFAULT 0,
        trend TEXT NOT NULL DEFAULT 'stable',
        trend_delta REAL NOT NULL DEFAULT 0,
        velocity_per_day REAL NOT NULL DEFAULT 0,
        estimated_fix_hours REAL NOT NULL DEFAULT 0,
        priority TEXT NOT NULL DEFAULT 'medium',
        recommendations TEXT NOT NULL DEFAULT '[]',
        confidence_alpha REAL NOT NULL DEFAULT 1.0,
        confidence_beta REAL NOT NULL DEFAULT 1.0,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (entity_id, entity_type)
      );
      CREATE INDEX IF NOT EXISTS idx_debt_total ON librarian_debt_metrics(total_debt DESC);
      CREATE INDEX IF NOT EXISTS idx_debt_priority ON librarian_debt_metrics(priority);
      CREATE INDEX IF NOT EXISTS idx_debt_trend ON librarian_debt_metrics(trend);

      -- Knowledge graph edges
      CREATE TABLE IF NOT EXISTS librarian_knowledge_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 1.0,
        metadata TEXT NOT NULL DEFAULT '{}',
        computed_at TEXT NOT NULL,
        valid_until TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kg_source ON librarian_knowledge_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_target ON librarian_knowledge_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_kg_edge_type ON librarian_knowledge_edges(edge_type);
      CREATE INDEX IF NOT EXISTS idx_kg_weight ON librarian_knowledge_edges(weight DESC);

      -- Fault localization results
      CREATE TABLE IF NOT EXISTS librarian_fault_localizations (
        id TEXT PRIMARY KEY,
        failure_signature TEXT NOT NULL,
        suspicious_entities TEXT NOT NULL,
        methodology TEXT NOT NULL,
        confidence REAL NOT NULL,
        computed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fault_signature ON librarian_fault_localizations(failure_signature);
      CREATE INDEX IF NOT EXISTS idx_fault_methodology ON librarian_fault_localizations(methodology);
    `);
  }

  private parseIngestionRow(row: {
    id?: string;
    source_type?: string;
    source_version?: string;
    ingested_at?: string;
    payload?: string;
    metadata?: string;
  }): IngestionItem | null {
    if (!row.id || !row.source_type || !row.source_version || !row.ingested_at) return null;
    const payloadRaw = typeof row.payload === 'string' ? row.payload : '{}';
    const metadataRaw = typeof row.metadata === 'string' ? row.metadata : '{}';
    const payloadParsed = safeJsonParse<unknown>(payloadRaw);
    const metadataParsed = safeJsonParse<Record<string, unknown>>(metadataRaw);
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceVersion: row.source_version,
      ingestedAt: row.ingested_at,
      payload: payloadParsed.ok ? payloadParsed.value : null,
      metadata: metadataParsed.ok ? metadataParsed.value : {},
    };
  }

  private sanitizeString(value: string): { value: string; counts: RedactionCounts } {
    const result = redactText(value);
    return { value: result.text, counts: result.counts };
  }

  private sanitizeStringArray(values: string[]): { values: string[]; counts: RedactionCounts } {
    let counts = createEmptyRedactionCounts();
    const sanitized = values.map((value) => {
      const result = redactText(value);
      counts = mergeRedactionCounts(counts, result.counts);
      return result.text;
    });
    return { values: sanitized, counts };
  }

  private sanitizeSnippet(snippet: CodeSnippet): { snippet: CodeSnippet; counts: RedactionCounts } {
    const filePathResult = this.sanitizeString(snippet.filePath);
    const languageResult = this.sanitizeString(snippet.language);
    const contentResult = redactText(snippet.content);
    const minimized = minimizeSnippet(contentResult.text);
    let counts = mergeRedactionCounts(filePathResult.counts, languageResult.counts);
    counts = mergeRedactionCounts(counts, contentResult.counts);
    return {
      snippet: {
        ...snippet,
        filePath: filePathResult.value,
        language: languageResult.value,
        content: minimized.text,
      },
      counts,
    };
  }

  private sanitizeFunction(fn: FunctionKnowledge): { fn: FunctionKnowledge; counts: RedactionCounts } {
    let counts = createEmptyRedactionCounts();
    const idResult = this.sanitizeString(fn.id);
    counts = mergeRedactionCounts(counts, idResult.counts);
    const filePathResult = this.sanitizeString(fn.filePath);
    counts = mergeRedactionCounts(counts, filePathResult.counts);
    const nameResult = this.sanitizeString(fn.name);
    counts = mergeRedactionCounts(counts, nameResult.counts);
    const signatureResult = this.sanitizeString(fn.signature);
    counts = mergeRedactionCounts(counts, signatureResult.counts);
    const purposeResult = this.sanitizeString(fn.purpose);
    counts = mergeRedactionCounts(counts, purposeResult.counts);
    const effectSignatureValues = Array.isArray(fn.effectSignature) ? fn.effectSignature : [];
    const effectSignatureResult = this.sanitizeStringArray(effectSignatureValues);
    counts = mergeRedactionCounts(counts, effectSignatureResult.counts);

    return {
      fn: {
        ...fn,
        id: idResult.value,
        filePath: filePathResult.value,
        name: nameResult.value,
        signature: signatureResult.value,
        purpose: purposeResult.value,
        effectSignature: effectSignatureResult.values,
      },
      counts,
    };
  }

  private sanitizeModule(mod: ModuleKnowledge): { mod: ModuleKnowledge; counts: RedactionCounts } {
    let counts = createEmptyRedactionCounts();
    const idResult = this.sanitizeString(mod.id);
    counts = mergeRedactionCounts(counts, idResult.counts);
    const pathResult = this.sanitizeString(mod.path);
    counts = mergeRedactionCounts(counts, pathResult.counts);
    const purposeResult = this.sanitizeString(mod.purpose);
    counts = mergeRedactionCounts(counts, purposeResult.counts);
    const exportsResult = this.sanitizeStringArray(mod.exports);
    counts = mergeRedactionCounts(counts, exportsResult.counts);
    const dependenciesResult = this.sanitizeStringArray(mod.dependencies);
    counts = mergeRedactionCounts(counts, dependenciesResult.counts);

    return {
      mod: {
        ...mod,
        id: idResult.value,
        path: pathResult.value,
        purpose: purposeResult.value,
        exports: exportsResult.values,
        dependencies: dependenciesResult.values,
      },
      counts,
    };
  }

  private normalizeContextPackPath(rawPath: string): string {
    const trimmed = rawPath.trim();
    if (!trimmed) return trimmed;
    const normalized = normalizeSqlPath(trimmed);
    if (!this.workspaceRoot) {
      return normalized;
    }
    const absolute = path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(this.workspaceRoot, normalized);
    const relative = normalizeSqlPath(path.relative(this.workspaceRoot, absolute));
    if (relative && relative !== '.' && !relative.startsWith('..')) {
      return relative;
    }
    return normalizeSqlPath(absolute);
  }

  private normalizeContextPack(pack: ContextPack): ContextPack {
    return {
      ...pack,
      relatedFiles: pack.relatedFiles.map((filePath) => this.normalizeContextPackPath(filePath)),
      invalidationTriggers: pack.invalidationTriggers.map((trigger) => this.normalizeContextPackPath(trigger)),
      codeSnippets: pack.codeSnippets.map((snippet) => ({
        ...snippet,
        filePath: this.normalizeContextPackPath(snippet.filePath),
      })),
    };
  }

  private sanitizeContextPack(pack: ContextPack): { pack: ContextPack; counts: RedactionCounts } {
    const normalizedPack = this.normalizeContextPack(pack);
    let counts = createEmptyRedactionCounts();
    const packIdResult = this.sanitizeString(normalizedPack.packId);
    counts = mergeRedactionCounts(counts, packIdResult.counts);
    const packTypeResult = this.sanitizeString(normalizedPack.packType);
    counts = mergeRedactionCounts(counts, packTypeResult.counts);
    const targetIdResult = this.sanitizeString(normalizedPack.targetId);
    counts = mergeRedactionCounts(counts, targetIdResult.counts);
    const summaryResult = this.sanitizeString(normalizedPack.summary);
    counts = mergeRedactionCounts(counts, summaryResult.counts);
    const keyFactsResult = this.sanitizeStringArray(normalizedPack.keyFacts);
    counts = mergeRedactionCounts(counts, keyFactsResult.counts);
    const relatedFilesResult = this.sanitizeStringArray(normalizedPack.relatedFiles);
    counts = mergeRedactionCounts(counts, relatedFilesResult.counts);
    const invalidationResult = this.sanitizeStringArray(normalizedPack.invalidationTriggers);
    counts = mergeRedactionCounts(counts, invalidationResult.counts);
    const lastOutcomeResult = this.sanitizeString(normalizedPack.lastOutcome);
    counts = mergeRedactionCounts(counts, lastOutcomeResult.counts);
    const versionStringResult = this.sanitizeString(normalizedPack.version.string);
    counts = mergeRedactionCounts(counts, versionStringResult.counts);

    const snippetResults = normalizedPack.codeSnippets.map((snippet) => this.sanitizeSnippet(snippet));
    for (const snippetResult of snippetResults) {
      counts = mergeRedactionCounts(counts, snippetResult.counts);
    }

    return {
      pack: {
        ...normalizedPack,
        packId: packIdResult.value,
        packType: packTypeResult.value as ContextPack['packType'],
        targetId: targetIdResult.value,
        summary: summaryResult.value,
        keyFacts: keyFactsResult.values,
        codeSnippets: snippetResults.map((result) => result.snippet),
        relatedFiles: relatedFilesResult.values,
        lastOutcome: lastOutcomeResult.value as ContextPack['lastOutcome'],
        version: {
          ...pack.version,
          string: versionStringResult.value,
        },
        invalidationTriggers: invalidationResult.values,
      },
      counts,
    };
  }

  private async recordRedactions(counts: RedactionCounts): Promise<void> {
    if (!this.workspaceRoot || counts.total === 0) return;
    this.redactionTotals = mergeRedactionCounts(this.redactionTotals, counts);
    const report = await createRedactionAuditReport(this.workspaceRoot, this.redactionTotals);
    await writeRedactionAuditReport(this.workspaceRoot, report);
  }

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  async getMetadata(): Promise<LiBrainianMetadata | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT value FROM librarian_metadata WHERE key = ?')
      .get('metadata') as { value: string } | undefined;

    if (!row) return noResult();
    const parsed = parseJsonOrNull<LiBrainianMetadata>(row.value);
    if (!parsed || typeof parsed !== 'object') {
      return noResult();
    }
    return {
      ...parsed,
      lastBootstrap: parseOptionalDate((parsed as { lastBootstrap?: unknown }).lastBootstrap),
      lastIndexing: parseOptionalDate((parsed as { lastIndexing?: unknown }).lastIndexing),
    };
  }

  async setMetadata(metadata: LiBrainianMetadata): Promise<void> {
    const db = this.ensureDb();
    db.prepare(
      'INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)'
    ).run('metadata', JSON.stringify(metadata));
  }

  async getState(key: string): Promise<string | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT value FROM librarian_metadata WHERE key = ?')
      .get(key) as { value?: string } | undefined;
    if (!row?.value) return noResult();
    return row.value;
  }

  async setState(key: string, value: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare(
      'INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)'
    ).run(key, value);
  }

  // --------------------------------------------------------------------------
  // Version
  // --------------------------------------------------------------------------

  async getVersion(): Promise<LiBrainianVersion | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT value FROM librarian_metadata WHERE key = ?')
      .get('version') as { value: string } | undefined;

    if (!row) return noResult();
    return parseJsonOrNull<LiBrainianVersion>(row.value);
  }

  async setVersion(version: LiBrainianVersion): Promise<void> {
    const db = this.ensureDb();
    db.prepare(
      'INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)'
    ).run('version', JSON.stringify(version));
  }

  // --------------------------------------------------------------------------
  // Functions
  // --------------------------------------------------------------------------

  async getFunctions(options: QueryOptions = {}): Promise<FunctionKnowledge[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_functions WHERE 1=1';
    const params: unknown[] = [];

    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    if (typeof options.isPure === 'boolean') {
      sql += ' AND is_pure = ?';
      params.push(options.isPure ? 1 : 0);
    }

    const orderCol = validateOrderColumn(options.orderBy || 'confidence');
    const orderDir = validateOrderDirection(options.orderDirection || 'desc');
    sql += ` ORDER BY ${orderCol} ${orderDir}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = db.prepare(sql).all(...params) as FunctionRow[];
    return rows.map(rowToFunction);
  }

  async getFunction(id: string): Promise<FunctionKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_functions WHERE id = ?')
      .get(id) as FunctionRow | undefined;
    return row ? rowToFunction(row) : null;
  }

  async getFunctionByPath(
    filePath: string,
    name: string
  ): Promise<FunctionKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_functions WHERE file_path = ? AND name = ?')
      .get(filePath, name) as FunctionRow | undefined;
    return row ? rowToFunction(row) : null;
  }

  async getFunctionsByPath(filePath: string): Promise<FunctionKnowledge[]> {
    const db = this.ensureDb();
    const rows = db
      .prepare('SELECT * FROM librarian_functions WHERE file_path = ?')
      .all(filePath) as FunctionRow[];
    return rows.map(rowToFunction);
  }

  async getFunctionsByName(name: string): Promise<FunctionKnowledge[]> {
    const db = this.ensureDb();
    const rows = db
      .prepare('SELECT * FROM librarian_functions WHERE name = ?')
      .all(name) as FunctionRow[];
    return rows.map(rowToFunction);
  }

  async upsertFunction(fn: FunctionKnowledge): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const { fn: sanitized, counts } = this.sanitizeFunction(fn);

    db.prepare(`
      INSERT INTO librarian_functions (
        id, file_path, name, signature, purpose, start_line, end_line,
        is_pure, has_side_effects, modifies_params, throws, return_depends_on_inputs, effect_signature,
        confidence, access_count, last_accessed, validation_count,
        outcome_successes, outcome_failures, created_at, updated_at, last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path, name) DO UPDATE SET
        signature = excluded.signature,
        purpose = excluded.purpose,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        is_pure = excluded.is_pure,
        has_side_effects = excluded.has_side_effects,
        modifies_params = excluded.modifies_params,
        throws = excluded.throws,
        return_depends_on_inputs = excluded.return_depends_on_inputs,
        effect_signature = excluded.effect_signature,
        confidence = excluded.confidence,
        access_count = excluded.access_count,
        last_accessed = excluded.last_accessed,
        validation_count = excluded.validation_count,
        outcome_successes = excluded.outcome_successes,
        outcome_failures = excluded.outcome_failures,
        updated_at = excluded.updated_at,
        last_verified_at = excluded.last_verified_at
    `).run(
      sanitized.id,
      sanitized.filePath,
      sanitized.name,
      sanitized.signature,
      sanitized.purpose,
      sanitized.startLine,
      sanitized.endLine,
      sanitized.isPure ? 1 : 0,
      sanitized.hasSideEffects ? 1 : 0,
      sanitized.modifiesParams ? 1 : 0,
      sanitized.throws ? 1 : 0,
      sanitized.returnDependsOnInputs ? 1 : 0,
      JSON.stringify(sanitized.effectSignature ?? []),
      sanitized.confidence,
      sanitized.accessCount,
      sanitized.lastAccessed?.toISOString() || null,
      sanitized.validationCount,
      sanitized.outcomeHistory.successes,
      sanitized.outcomeHistory.failures,
      now,
      now,
      now
    );
    await this.recordRedactions(counts);
  }

  async upsertFunctions(fns: FunctionKnowledge[]): Promise<void> {
    const db = this.ensureDb();
    const insert = db.prepare(`
      INSERT INTO librarian_functions (
        id, file_path, name, signature, purpose, start_line, end_line,
        is_pure, has_side_effects, modifies_params, throws, return_depends_on_inputs, effect_signature,
        confidence, access_count, last_accessed, validation_count,
        outcome_successes, outcome_failures, created_at, updated_at, last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path, name) DO UPDATE SET
        signature = excluded.signature,
        purpose = excluded.purpose,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        is_pure = excluded.is_pure,
        has_side_effects = excluded.has_side_effects,
        modifies_params = excluded.modifies_params,
        throws = excluded.throws,
        return_depends_on_inputs = excluded.return_depends_on_inputs,
        effect_signature = excluded.effect_signature,
        updated_at = excluded.updated_at,
        last_verified_at = excluded.last_verified_at
    `);

    const now = new Date().toISOString();
    let totalCounts = createEmptyRedactionCounts();
    const sanitizedFns = fns.map((fn) => {
      const { fn: sanitized, counts } = this.sanitizeFunction(fn);
      totalCounts = mergeRedactionCounts(totalCounts, counts);
      return sanitized;
    });

    const insertMany = db.transaction((functions: FunctionKnowledge[]) => {
      for (const fn of functions) {
        insert.run(
          fn.id,
          fn.filePath,
          fn.name,
          fn.signature,
          fn.purpose,
          fn.startLine,
          fn.endLine,
          fn.isPure ? 1 : 0,
          fn.hasSideEffects ? 1 : 0,
          fn.modifiesParams ? 1 : 0,
          fn.throws ? 1 : 0,
          fn.returnDependsOnInputs ? 1 : 0,
          JSON.stringify(fn.effectSignature ?? []),
          fn.confidence,
          fn.accessCount,
          fn.lastAccessed?.toISOString() || null,
          fn.validationCount,
          fn.outcomeHistory.successes,
          fn.outcomeHistory.failures,
          now,
          now,
          now
        );
      }
    });

    insertMany(sanitizedFns);
    await this.recordRedactions(totalCounts);
  }

  async deleteFunction(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_functions WHERE id = ?').run(id);
    db.prepare('DELETE FROM librarian_embeddings WHERE entity_id = ?').run(id);
  }

  async deleteFunctionsByPath(filePath: string): Promise<void> {
    const db = this.ensureDb();
    const ids = db
      .prepare('SELECT id FROM librarian_functions WHERE file_path = ?')
      .all(filePath) as { id: string }[];

    const deleteFn = db.prepare('DELETE FROM librarian_functions WHERE file_path = ?');
    const deleteEmbed = db.prepare('DELETE FROM librarian_embeddings WHERE entity_id = ?');

    db.transaction(() => {
      deleteFn.run(filePath);
      for (const { id } of ids) {
        deleteEmbed.run(id);
      }
    })();
  }

  // --------------------------------------------------------------------------
  // Modules
  // --------------------------------------------------------------------------

  async getModules(options: QueryOptions = {}): Promise<ModuleKnowledge[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_modules WHERE 1=1';
    const params: unknown[] = [];

    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as ModuleRow[];
    return rows.map(rowToModule);
  }

  async getModule(id: string): Promise<ModuleKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_modules WHERE id = ?')
      .get(id) as ModuleRow | undefined;
    return row ? rowToModule(row) : null;
  }

  async getModuleByPath(modulePath: string): Promise<ModuleKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_modules WHERE path = ?')
      .get(modulePath) as ModuleRow | undefined;
    return row ? rowToModule(row) : null;
  }

  async upsertModule(mod: ModuleKnowledge): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const { mod: sanitized, counts } = this.sanitizeModule(mod);

    db.prepare(`
      INSERT INTO librarian_modules (id, path, purpose, exports, dependencies, confidence, created_at, updated_at, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        purpose = excluded.purpose,
        exports = excluded.exports,
        dependencies = excluded.dependencies,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at,
        last_verified_at = excluded.last_verified_at
    `).run(
      sanitized.id,
      sanitized.path,
      sanitized.purpose,
      JSON.stringify(sanitized.exports),
      JSON.stringify(sanitized.dependencies),
      sanitized.confidence,
      now,
      now,
      now
    );
    await this.recordRedactions(counts);
  }

  async deleteModule(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_modules WHERE id = ?').run(id);
    db.prepare('DELETE FROM librarian_embeddings WHERE entity_id = ?').run(id);
  }

  // --------------------------------------------------------------------------
  // File Knowledge
  // --------------------------------------------------------------------------

  async getFiles(options: FileQueryOptions = {}): Promise<FileKnowledge[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_files WHERE 1=1';
    const params: unknown[] = [];

    if (options.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }
    if (options.extension) {
      sql += ' AND extension = ?';
      params.push(options.extension);
    }
    if (options.directory) {
      sql += ' AND directory = ?';
      params.push(options.directory);
    }
    if (options.hasTests !== undefined) {
      sql += ' AND has_tests = ?';
      params.push(options.hasTests ? 1 : 0);
    }
    if (options.complexity) {
      sql += ' AND complexity = ?';
      params.push(options.complexity);
    }
    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    const orderBy = options.orderBy || 'name';
    const orderColMapping: Record<string, string> = {
      name: 'name',
      confidence: 'confidence',
      lastIndexed: 'last_indexed',
      lineCount: 'line_count',
      complexity: 'complexity',
    };
    const orderCol = validateOrderColumn(orderColMapping[orderBy] || 'name');
    const dir = validateOrderDirection(options.orderDirection || 'asc');
    sql += ` ORDER BY ${orderCol} ${dir}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = db.prepare(sql).all(...params) as FileKnowledgeRow[];
    return rows.map(this.rowToFileKnowledge.bind(this));
  }

  async getFile(id: string): Promise<FileKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_files WHERE id = ?')
      .get(id) as FileKnowledgeRow | undefined;
    return row ? this.rowToFileKnowledge(row) : null;
  }

  async getFileByPath(path: string): Promise<FileKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_files WHERE path = ?')
      .get(path) as FileKnowledgeRow | undefined;
    return row ? this.rowToFileKnowledge(row) : null;
  }

  async getFilesByDirectory(directoryPath: string): Promise<FileKnowledge[]> {
    const db = this.ensureDb();
    const rows = db
      .prepare('SELECT * FROM librarian_files WHERE directory = ?')
      .all(directoryPath) as FileKnowledgeRow[];
    return rows.map(this.rowToFileKnowledge.bind(this));
  }

  async upsertFile(file: FileKnowledge): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_files (
        id, path, relative_path, name, extension, category, purpose, role,
        summary, key_exports, main_concepts, line_count, function_count,
        class_count, import_count, export_count, imports, imported_by,
        directory, complexity, test_coverage, has_tests, checksum,
        confidence, last_indexed, last_modified, llm_evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        relative_path = excluded.relative_path,
        name = excluded.name,
        extension = excluded.extension,
        category = excluded.category,
        purpose = excluded.purpose,
        role = excluded.role,
        summary = excluded.summary,
        key_exports = excluded.key_exports,
        main_concepts = excluded.main_concepts,
        line_count = excluded.line_count,
        function_count = excluded.function_count,
        class_count = excluded.class_count,
        import_count = excluded.import_count,
        export_count = excluded.export_count,
        imports = excluded.imports,
        imported_by = excluded.imported_by,
        directory = excluded.directory,
        complexity = excluded.complexity,
        test_coverage = excluded.test_coverage,
        has_tests = excluded.has_tests,
        checksum = excluded.checksum,
        confidence = excluded.confidence,
        last_indexed = excluded.last_indexed,
        last_modified = excluded.last_modified,
        llm_evidence = excluded.llm_evidence
    `).run(
      file.id,
      file.path,
      file.relativePath,
      file.name,
      file.extension,
      file.category,
      file.purpose,
      file.role,
      file.summary,
      JSON.stringify(file.keyExports),
      JSON.stringify(file.mainConcepts),
      file.lineCount,
      file.functionCount,
      file.classCount,
      file.importCount,
      file.exportCount,
      JSON.stringify(file.imports),
      JSON.stringify(file.importedBy),
      file.directory,
      file.complexity,
      file.testCoverage ?? null,
      file.hasTests ? 1 : 0,
      file.checksum,
      file.confidence,
      file.lastIndexed,
      file.lastModified,
      file.llmEvidence ? JSON.stringify(file.llmEvidence) : null
    );
  }

  async upsertFiles(files: FileKnowledge[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO librarian_files (
        id, path, relative_path, name, extension, category, purpose, role,
        summary, key_exports, main_concepts, line_count, function_count,
        class_count, import_count, export_count, imports, imported_by,
        directory, complexity, test_coverage, has_tests, checksum,
        confidence, last_indexed, last_modified, llm_evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        relative_path = excluded.relative_path,
        name = excluded.name,
        extension = excluded.extension,
        category = excluded.category,
        purpose = excluded.purpose,
        role = excluded.role,
        summary = excluded.summary,
        key_exports = excluded.key_exports,
        main_concepts = excluded.main_concepts,
        line_count = excluded.line_count,
        function_count = excluded.function_count,
        class_count = excluded.class_count,
        import_count = excluded.import_count,
        export_count = excluded.export_count,
        imports = excluded.imports,
        imported_by = excluded.imported_by,
        directory = excluded.directory,
        complexity = excluded.complexity,
        test_coverage = excluded.test_coverage,
        has_tests = excluded.has_tests,
        checksum = excluded.checksum,
        confidence = excluded.confidence,
        last_indexed = excluded.last_indexed,
        last_modified = excluded.last_modified,
        llm_evidence = excluded.llm_evidence
    `);

    const insertMany = db.transaction((files: FileKnowledge[]) => {
      for (const file of files) {
        stmt.run(
          file.id,
          file.path,
          file.relativePath,
          file.name,
          file.extension,
          file.category,
          file.purpose,
          file.role,
          file.summary,
          JSON.stringify(file.keyExports),
          JSON.stringify(file.mainConcepts),
          file.lineCount,
          file.functionCount,
          file.classCount,
          file.importCount,
          file.exportCount,
          JSON.stringify(file.imports),
          JSON.stringify(file.importedBy),
          file.directory,
          file.complexity,
          file.testCoverage ?? null,
          file.hasTests ? 1 : 0,
          file.checksum,
          file.confidence,
          file.lastIndexed,
          file.lastModified,
          file.llmEvidence ? JSON.stringify(file.llmEvidence) : null
        );
      }
    });
    insertMany(files);
  }

  async deleteFile(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_files WHERE id = ?').run(id);
  }

  async deleteFileByPath(path: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_files WHERE path = ?').run(path);
  }

  private rowToFileKnowledge(row: FileKnowledgeRow): FileKnowledge {
    // Safely parse JSON arrays with null/undefined fallbacks
    const result: FileKnowledge = {
      id: row.id,
      path: row.path,
      relativePath: row.relative_path,
      name: row.name,
      extension: row.extension,
      category: row.category as FileKnowledge['category'],
      purpose: row.purpose,
      role: row.role,
      summary: row.summary,
      keyExports: parseStringArray(row.key_exports ?? '[]'),
      mainConcepts: parseStringArray(row.main_concepts ?? '[]'),
      lineCount: row.line_count,
      functionCount: row.function_count,
      classCount: row.class_count,
      importCount: row.import_count,
      exportCount: row.export_count,
      imports: parseStringArray(row.imports ?? '[]'),
      importedBy: parseStringArray(row.imported_by ?? '[]'),
      directory: row.directory,
      complexity: row.complexity as FileKnowledge['complexity'],
      testCoverage: row.test_coverage ?? undefined,
      hasTests: row.has_tests === 1,
      checksum: row.checksum,
      confidence: row.confidence,
      lastIndexed: row.last_indexed,
      lastModified: row.last_modified,
    };

    // Parse LLM evidence if present
    if (row.llm_evidence) {
      try {
        result.llmEvidence = JSON.parse(row.llm_evidence);
      } catch {
        // Ignore parse errors - field remains undefined
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Directory Knowledge
  // --------------------------------------------------------------------------

  async getDirectories(options: DirectoryQueryOptions = {}): Promise<DirectoryKnowledge[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_directories WHERE 1=1';
    const params: unknown[] = [];

    if (options.role) {
      sql += ' AND role = ?';
      params.push(options.role);
    }
    if (options.parent) {
      sql += ' AND parent = ?';
      params.push(options.parent);
    }
    if (options.minDepth !== undefined) {
      sql += ' AND depth >= ?';
      params.push(options.minDepth);
    }
    if (options.maxDepth !== undefined) {
      sql += ' AND depth <= ?';
      params.push(options.maxDepth);
    }
    if (options.hasReadme !== undefined) {
      sql += ' AND has_readme = ?';
      params.push(options.hasReadme ? 1 : 0);
    }
    if (options.hasIndex !== undefined) {
      sql += ' AND has_index = ?';
      params.push(options.hasIndex ? 1 : 0);
    }
    if (options.hasTests !== undefined) {
      sql += ' AND has_tests = ?';
      params.push(options.hasTests ? 1 : 0);
    }
    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    const orderBy = options.orderBy || 'name';
    const orderColMapping: Record<string, string> = {
      name: 'name',
      confidence: 'confidence',
      lastIndexed: 'last_indexed',
      depth: 'depth',
      totalFiles: 'total_files',
    };
    const orderCol = validateOrderColumn(orderColMapping[orderBy] || 'name');
    const dir = validateOrderDirection(options.orderDirection || 'asc');
    sql += ` ORDER BY ${orderCol} ${dir}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = db.prepare(sql).all(...params) as DirectoryKnowledgeRow[];
    return rows.map(this.rowToDirectoryKnowledge.bind(this));
  }

  async getDirectory(id: string): Promise<DirectoryKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_directories WHERE id = ?')
      .get(id) as DirectoryKnowledgeRow | undefined;
    return row ? this.rowToDirectoryKnowledge(row) : null;
  }

  async getDirectoryByPath(path: string): Promise<DirectoryKnowledge | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_directories WHERE path = ?')
      .get(path) as DirectoryKnowledgeRow | undefined;
    return row ? this.rowToDirectoryKnowledge(row) : null;
  }

  async getSubdirectories(parentPath: string): Promise<DirectoryKnowledge[]> {
    const db = this.ensureDb();
    const rows = db
      .prepare('SELECT * FROM librarian_directories WHERE parent = ?')
      .all(parentPath) as DirectoryKnowledgeRow[];
    return rows.map(this.rowToDirectoryKnowledge.bind(this));
  }

  async upsertDirectory(dir: DirectoryKnowledge): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_directories (
        id, path, relative_path, name, fingerprint, purpose, role, description,
        bounded_context, pattern, depth, file_count, subdirectory_count,
        total_files, main_files, subdirectories, file_types, parent,
        siblings, related_directories, has_readme, has_index, has_tests,
        complexity, confidence, last_indexed, llm_evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        relative_path = excluded.relative_path,
        name = excluded.name,
        fingerprint = excluded.fingerprint,
        purpose = excluded.purpose,
        role = excluded.role,
        description = excluded.description,
        bounded_context = excluded.bounded_context,
        pattern = excluded.pattern,
        depth = excluded.depth,
        file_count = excluded.file_count,
        subdirectory_count = excluded.subdirectory_count,
        total_files = excluded.total_files,
        main_files = excluded.main_files,
        subdirectories = excluded.subdirectories,
        file_types = excluded.file_types,
        parent = excluded.parent,
        siblings = excluded.siblings,
        related_directories = excluded.related_directories,
        has_readme = excluded.has_readme,
        has_index = excluded.has_index,
        has_tests = excluded.has_tests,
        complexity = excluded.complexity,
        confidence = excluded.confidence,
        last_indexed = excluded.last_indexed,
        llm_evidence = excluded.llm_evidence
    `).run(
      dir.id,
      dir.path,
      dir.relativePath,
      dir.name,
      dir.fingerprint,
      dir.purpose,
      dir.role,
      dir.description,
      dir.boundedContext ?? null,
      dir.pattern,
      dir.depth,
      dir.fileCount,
      dir.subdirectoryCount,
      dir.totalFiles,
      JSON.stringify(dir.mainFiles),
      JSON.stringify(dir.subdirectories),
      JSON.stringify(dir.fileTypes),
      dir.parent,
      JSON.stringify(dir.siblings),
      JSON.stringify(dir.relatedDirectories),
      dir.hasReadme ? 1 : 0,
      dir.hasIndex ? 1 : 0,
      dir.hasTests ? 1 : 0,
      dir.complexity,
      dir.confidence,
      dir.lastIndexed,
      dir.llmEvidence ? JSON.stringify(dir.llmEvidence) : null
    );
  }

  async upsertDirectories(dirs: DirectoryKnowledge[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO librarian_directories (
        id, path, relative_path, name, fingerprint, purpose, role, description,
        bounded_context, pattern, depth, file_count, subdirectory_count,
        total_files, main_files, subdirectories, file_types, parent,
        siblings, related_directories, has_readme, has_index, has_tests,
        complexity, confidence, last_indexed, llm_evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        relative_path = excluded.relative_path,
        name = excluded.name,
        fingerprint = excluded.fingerprint,
        purpose = excluded.purpose,
        role = excluded.role,
        description = excluded.description,
        bounded_context = excluded.bounded_context,
        pattern = excluded.pattern,
        depth = excluded.depth,
        file_count = excluded.file_count,
        subdirectory_count = excluded.subdirectory_count,
        total_files = excluded.total_files,
        main_files = excluded.main_files,
        subdirectories = excluded.subdirectories,
        file_types = excluded.file_types,
        parent = excluded.parent,
        siblings = excluded.siblings,
        related_directories = excluded.related_directories,
        has_readme = excluded.has_readme,
        has_index = excluded.has_index,
        has_tests = excluded.has_tests,
        complexity = excluded.complexity,
        confidence = excluded.confidence,
        last_indexed = excluded.last_indexed,
        llm_evidence = excluded.llm_evidence
    `);

    const insertMany = db.transaction((dirs: DirectoryKnowledge[]) => {
      for (const dir of dirs) {
        stmt.run(
          dir.id,
          dir.path,
          dir.relativePath,
          dir.name,
          dir.fingerprint,
          dir.purpose,
          dir.role,
          dir.description,
          dir.boundedContext ?? null,
          dir.pattern,
          dir.depth,
          dir.fileCount,
          dir.subdirectoryCount,
          dir.totalFiles,
          JSON.stringify(dir.mainFiles),
          JSON.stringify(dir.subdirectories),
          JSON.stringify(dir.fileTypes),
          dir.parent,
          JSON.stringify(dir.siblings),
          JSON.stringify(dir.relatedDirectories),
          dir.hasReadme ? 1 : 0,
          dir.hasIndex ? 1 : 0,
          dir.hasTests ? 1 : 0,
          dir.complexity,
          dir.confidence,
          dir.lastIndexed,
          dir.llmEvidence ? JSON.stringify(dir.llmEvidence) : null
        );
      }
    });
    insertMany(dirs);
  }

  async deleteDirectory(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_directories WHERE id = ?').run(id);
  }

  async deleteDirectoryByPath(path: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_directories WHERE path = ?').run(path);
  }

  private rowToDirectoryKnowledge(row: DirectoryKnowledgeRow): DirectoryKnowledge {
    // Safely parse fileTypes JSON with validation
    let fileTypes: Record<string, number> = {};
    if (row.file_types) {
      try {
        const parsed = JSON.parse(row.file_types);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Validate each value is a number
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'number' && !isNaN(value)) {
              fileTypes[key] = value;
            }
          }
        }
      } catch {
        // Log warning for debugging but don't crash
        console.warn(`[librarian] Invalid file_types JSON for directory ${row.path}`);
      }
    }

    // Safely parse all JSON arrays with null/undefined fallbacks
    const result: DirectoryKnowledge = {
      id: row.id,
      path: row.path,
      relativePath: row.relative_path,
      name: row.name,
      fingerprint: row.fingerprint ?? '',
      purpose: row.purpose,
      role: row.role as DirectoryKnowledge['role'],
      description: row.description,
      boundedContext: row.bounded_context ?? undefined,
      pattern: row.pattern as DirectoryKnowledge['pattern'],
      depth: row.depth,
      fileCount: row.file_count,
      subdirectoryCount: row.subdirectory_count,
      totalFiles: row.total_files,
      mainFiles: parseStringArray(row.main_files ?? '[]'),
      subdirectories: parseStringArray(row.subdirectories ?? '[]'),
      fileTypes,
      parent: row.parent,
      siblings: parseStringArray(row.siblings ?? '[]'),
      relatedDirectories: parseStringArray(row.related_directories ?? '[]'),
      hasReadme: row.has_readme === 1,
      hasIndex: row.has_index === 1,
      hasTests: row.has_tests === 1,
      complexity: row.complexity as DirectoryKnowledge['complexity'],
      confidence: row.confidence,
      lastIndexed: row.last_indexed,
    };

    // Parse LLM evidence if present
    if (row.llm_evidence) {
      try {
        result.llmEvidence = JSON.parse(row.llm_evidence);
      } catch {
        // Ignore parse errors - field remains undefined
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Flash Assessments
  // --------------------------------------------------------------------------

  async getAssessment(entityId: string): Promise<FlashAssessment | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_assessments WHERE entity_id = ?')
      .get(entityId) as AssessmentRow | undefined;
    return row ? this.rowToAssessment(row) : null;
  }

  async getAssessmentByPath(entityPath: string): Promise<FlashAssessment | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_assessments WHERE entity_path = ?')
      .get(entityPath) as AssessmentRow | undefined;
    return row ? this.rowToAssessment(row) : null;
  }

  async getAssessments(options: AssessmentQueryOptions = {}): Promise<FlashAssessment[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_assessments WHERE 1=1';
    const params: unknown[] = [];

    if (options.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options.overallHealth) {
      sql += ' AND overall_health = ?';
      params.push(options.overallHealth);
    }
    if (options.minHealthScore !== undefined) {
      sql += ' AND health_score >= ?';
      params.push(options.minHealthScore);
    }
    if (options.maxHealthScore !== undefined) {
      sql += ' AND health_score <= ?';
      params.push(options.maxHealthScore);
    }

    const orderColMapping: Record<string, string> = {
      healthScore: 'health_score',
      assessedAt: 'assessed_at',
      entityPath: 'entity_path',
    };
    const orderCol = validateOrderColumn(orderColMapping[options.orderBy || 'healthScore'] || 'health_score');
    const orderDir = validateOrderDirection(options.orderDirection || 'desc');
    sql += ` ORDER BY ${orderCol} ${orderDir}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = db.prepare(sql).all(...params) as AssessmentRow[];
    return rows.map((r) => this.rowToAssessment(r));
  }

  async upsertAssessment(assessment: FlashAssessment): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_assessments (
        entity_id, entity_type, entity_path, findings, overall_health,
        health_score, quick_summary, assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        entity_type = excluded.entity_type,
        entity_path = excluded.entity_path,
        findings = excluded.findings,
        overall_health = excluded.overall_health,
        health_score = excluded.health_score,
        quick_summary = excluded.quick_summary,
        assessed_at = excluded.assessed_at
    `).run(
      assessment.entityId,
      assessment.entityType,
      assessment.entityPath,
      JSON.stringify(assessment.findings),
      assessment.overallHealth,
      assessment.healthScore,
      assessment.quickSummary,
      assessment.assessedAt
    );
  }

  async upsertAssessments(assessments: FlashAssessment[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO librarian_assessments (
        entity_id, entity_type, entity_path, findings, overall_health,
        health_score, quick_summary, assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        entity_type = excluded.entity_type,
        entity_path = excluded.entity_path,
        findings = excluded.findings,
        overall_health = excluded.overall_health,
        health_score = excluded.health_score,
        quick_summary = excluded.quick_summary,
        assessed_at = excluded.assessed_at
    `);

    const insertMany = db.transaction((items: FlashAssessment[]) => {
      for (const a of items) {
        stmt.run(
          a.entityId,
          a.entityType,
          a.entityPath,
          JSON.stringify(a.findings),
          a.overallHealth,
          a.healthScore,
          a.quickSummary,
          a.assessedAt
        );
      }
    });
    insertMany(assessments);
  }

  async deleteAssessment(entityId: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_assessments WHERE entity_id = ?').run(entityId);
  }

  async deleteAssessmentByPath(entityPath: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_assessments WHERE entity_path = ?').run(entityPath);
  }

  private rowToAssessment(row: AssessmentRow): FlashAssessment {
    let findings: FlashFinding[] = [];
    try {
      const parsed = JSON.parse(row.findings);
      if (Array.isArray(parsed)) {
        findings = parsed;
      }
    } catch {
      // Use empty array if parsing fails
    }

    return {
      entityId: row.entity_id,
      entityType: row.entity_type as 'file' | 'directory',
      entityPath: row.entity_path,
      findings,
      overallHealth: row.overall_health as FlashAssessment['overallHealth'],
      healthScore: row.health_score,
      quickSummary: row.quick_summary,
      assessedAt: row.assessed_at,
    };
  }

  // --------------------------------------------------------------------------
  // Context Packs
  // --------------------------------------------------------------------------

  async getContextPacks(options: ContextPackQueryOptions = {}): Promise<ContextPack[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_context_packs WHERE 1=1';
    const params: unknown[] = [];
    const relatedPathExpr = "lower(replace(rf.value, '\\\\', '/'))";

    if (!options.includeInvalidated) {
      sql += ' AND invalidated = 0';
    }
    if (options.packType) {
      sql += ' AND pack_type = ?';
      params.push(options.packType);
    }
    if (options.targetId) {
      sql += ' AND target_id = ?';
      params.push(options.targetId);
    }
    const relatedFileCandidates = new Set<string>();
    const addRelatedFileCandidate = (value: string): void => {
      const trimmed = value.trim();
      if (!trimmed) return;
      const normalized = normalizeSqlPath(trimmed).toLowerCase();
      relatedFileCandidates.add(normalized);
      if (this.workspaceRoot) {
        const absolute = path.isAbsolute(trimmed)
          ? path.resolve(trimmed)
          : path.resolve(this.workspaceRoot, trimmed);
        relatedFileCandidates.add(normalizeSqlPath(absolute).toLowerCase());
        const relative = normalizeSqlPath(path.relative(this.workspaceRoot, absolute)).toLowerCase();
        if (relative && relative !== '.' && !relative.startsWith('..')) {
          relatedFileCandidates.add(relative);
        }
      }
    };
    if (options.relatedFile) {
      addRelatedFileCandidate(options.relatedFile);
    }
    for (const value of options.relatedFilesAny ?? []) {
      if (typeof value === 'string') addRelatedFileCandidate(value);
    }
    if (relatedFileCandidates.size > 0) {
      const placeholders = Array.from(relatedFileCandidates).map(() => '?').join(', ');
      sql += ` AND EXISTS (SELECT 1 FROM json_each(librarian_context_packs.related_files) rf WHERE ${relatedPathExpr} IN (${placeholders}))`;
      params.push(...Array.from(relatedFileCandidates));
    }

    const prefixCandidates = normalizeFilterPathPrefix(options.relatedFilePrefix, this.workspaceRoot);
    if (prefixCandidates.length > 0) {
      const clauses = prefixCandidates.map(() => `${relatedPathExpr} LIKE ?`).join(' OR ');
      sql += ` AND EXISTS (SELECT 1 FROM json_each(librarian_context_packs.related_files) rf WHERE (${clauses}))`;
      params.push(...prefixCandidates.map((prefix) => `${prefix}%`));
    }

    const languageExtensions = normalizeLanguageExtensions(options.language);
    if (languageExtensions.length > 0) {
      const clauses = languageExtensions.map(() => `${relatedPathExpr} LIKE ?`).join(' OR ');
      sql += ` AND EXISTS (SELECT 1 FROM json_each(librarian_context_packs.related_files) rf WHERE (${clauses}))`;
      params.push(...languageExtensions.map((ext) => `%${ext}`));
    }

    if (options.excludeTests) {
      const testPatterns = ['%/__tests__/%', '%.test.%', '%.spec.%', '%/test/%', '%/tests/%'];
      const clauses = testPatterns.map(() => `${relatedPathExpr} LIKE ?`).join(' OR ');
      sql += ` AND NOT EXISTS (SELECT 1 FROM json_each(librarian_context_packs.related_files) rf WHERE (${clauses}))`;
      params.push(...testPatterns);
    }
    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as ContextPackRow[];
    return rows.map(rowToContextPack);
  }

  async getContextPack(packId: string): Promise<ContextPack | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_context_packs WHERE pack_id = ?')
      .get(packId) as ContextPackRow | undefined;
    return row ? rowToContextPack(row) : null;
  }

  async getContextPackForTarget(
    targetId: string,
    packType: string
  ): Promise<ContextPack | null> {
    const db = this.ensureDb();
    const row = db
      .prepare(
        'SELECT * FROM librarian_context_packs WHERE target_id = ? AND pack_type = ? AND invalidated = 0'
      )
      .get(targetId, packType) as ContextPackRow | undefined;
    return row ? rowToContextPack(row) : null;
  }

  async upsertContextPack(pack: ContextPack): Promise<void> {
    const db = this.ensureDb();
    const { pack: sanitized, counts } = this.sanitizeContextPack(pack);
    const schemaVersion = sanitized.schemaVersion ?? 1;
    const contentHash = computeContextPackContentHash(sanitized);

    db.prepare(`
      INSERT INTO librarian_context_packs (
        pack_id, pack_type, target_id, summary, key_facts, code_snippets,
        related_files, confidence, created_at, access_count, last_outcome,
        success_count, failure_count, version_string, content_hash, schema_version, invalidation_triggers,
        invalidated, last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_id, pack_type) DO UPDATE SET
        summary = excluded.summary,
        key_facts = excluded.key_facts,
        code_snippets = excluded.code_snippets,
        related_files = excluded.related_files,
        confidence = excluded.confidence,
        success_count = librarian_context_packs.success_count,
        failure_count = librarian_context_packs.failure_count,
        version_string = excluded.version_string,
        content_hash = excluded.content_hash,
        schema_version = excluded.schema_version,
        invalidation_triggers = excluded.invalidation_triggers,
        invalidated = 0,
        last_verified_at = excluded.last_verified_at
    `).run(
      sanitized.packId,
      sanitized.packType,
      sanitized.targetId,
      sanitized.summary,
      JSON.stringify(sanitized.keyFacts),
      JSON.stringify(sanitized.codeSnippets),
      JSON.stringify(sanitized.relatedFiles),
      sanitized.confidence,
      sanitized.createdAt.toISOString(),
      sanitized.accessCount,
      sanitized.lastOutcome,
      sanitized.successCount ?? 0,
      sanitized.failureCount ?? 0,
      sanitized.version.string,
      contentHash,
      schemaVersion,
      JSON.stringify(sanitized.invalidationTriggers),
      0,
      new Date().toISOString()
    );
    await this.recordRedactions(counts);
  }

  async invalidateContextPacks(triggerPath: string): Promise<number> {
    const db = this.ensureDb();

    // Find packs that have this path in their invalidation triggers
    // Using JSON search (SQLite JSON1 extension)
    const result = db
      .prepare(`
        UPDATE librarian_context_packs
        SET invalidated = 1
        WHERE invalidation_triggers IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(librarian_context_packs.invalidation_triggers)
            WHERE value = ?
          )
      `)
      .run(triggerPath);

    return result.changes;
  }

  async deleteContextPack(packId: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_context_packs WHERE pack_id = ?').run(packId);
  }

  async recordContextPackAccess(
    packId: string,
    outcome?: 'success' | 'failure'
  ): Promise<void> {
    const db = this.ensureDb();
    let sql = 'UPDATE librarian_context_packs SET access_count = access_count + 1';
    const params: unknown[] = [];

    if (outcome) {
      sql += ', last_outcome = ?';
      params.push(outcome);
      if (outcome === 'success') {
        sql += ', success_count = success_count + 1';
      } else if (outcome === 'failure') {
        sql += ', failure_count = failure_count + 1';
      }
    }

    sql += ' WHERE pack_id = ?';
    params.push(packId);

    db.prepare(sql).run(...params);
  }

  // --------------------------------------------------------------------------
  // Ingestion items
  // --------------------------------------------------------------------------

  async getIngestionItem(id: string): Promise<IngestionItem | null> {
    const db = this.ensureDb();
    const row = db.prepare(
      'SELECT id, source_type, source_version, ingested_at, payload, metadata FROM librarian_ingested_items WHERE id = ?'
    ).get(id) as {
      id?: string;
      source_type?: string;
      source_version?: string;
      ingested_at?: string;
      payload?: string;
      metadata?: string;
    } | undefined;
    if (!row?.id || !row.source_type || !row.source_version || !row.ingested_at) {
      return noResult();
    }
    return this.parseIngestionRow(row);
  }

  async getIngestionItems(options: IngestionQueryOptions = {}): Promise<IngestionItem[]> {
    const db = this.ensureDb();
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (options.sourceType) {
      filters.push('source_type = ?');
      params.push(options.sourceType);
    }

    const orderBy = validateOrderColumn(options.orderBy === 'source_type' ? 'source_type' : 'ingested_at');
    const orderDirection = validateOrderDirection(options.orderDirection || 'desc');
    const limit = Math.max(1, options.limit ?? 200);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = db.prepare(
      `SELECT id, source_type, source_version, ingested_at, payload, metadata FROM librarian_ingested_items ${where} ORDER BY ${orderBy} ${orderDirection} LIMIT ?`
    ).all(...params, limit) as Array<{
      id?: string;
      source_type?: string;
      source_version?: string;
      ingested_at?: string;
      payload?: string;
      metadata?: string;
    }>;

    return rows
      .map((row) => this.parseIngestionRow(row))
      .filter((item): item is IngestionItem => item !== null);
  }

  async upsertIngestionItem(item: IngestionItem): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_ingested_items (id, source_type, source_version, ingested_at, payload, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_type = excluded.source_type,
        source_version = excluded.source_version,
        ingested_at = excluded.ingested_at,
        payload = excluded.payload,
        metadata = excluded.metadata
    `).run(
      item.id,
      item.sourceType,
      item.sourceVersion,
      item.ingestedAt,
      JSON.stringify(item.payload),
      JSON.stringify(item.metadata)
    );
  }

  async deleteIngestionItem(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_ingested_items WHERE id = ?').run(id);
  }

  // --------------------------------------------------------------------------
  // File checksums (incremental indexing)
  // --------------------------------------------------------------------------

  async getFileChecksum(filePath: string): Promise<string | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT checksum FROM librarian_file_checksums WHERE file_path = ?')
      .get(filePath) as { checksum?: string } | undefined;
    if (!row?.checksum) return noResult();
    return row.checksum;
  }

  async isFileIndexed(filePath: string): Promise<boolean> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);
    if (!fileResult.value) return false;

    const functionRow = db
      .prepare('SELECT 1 FROM librarian_functions WHERE file_path = ? LIMIT 1')
      .get(fileResult.value) as { 1?: number } | undefined;
    if (functionRow) return true;

    const moduleRow = db
      .prepare('SELECT 1 FROM librarian_modules WHERE path = ? LIMIT 1')
      .get(fileResult.value) as { 1?: number } | undefined;
    if (moduleRow) return true;

    const packRow = db
      .prepare('SELECT 1 FROM librarian_context_packs WHERE related_files LIKE ? LIMIT 1')
      .get(`%\"${fileResult.value}\"%`) as { 1?: number } | undefined;
    return Boolean(packRow);
  }

  async getFileIndexStats(filePath: string): Promise<{ functions: number; modules: number; embeddings: number; moduleEmbeddings: number; contextPacks: number }> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);
    if (!fileResult.value) {
      return { functions: 0, modules: 0, embeddings: 0, moduleEmbeddings: 0, contextPacks: 0 };
    }
    const functionRow = db
      .prepare('SELECT COUNT(*) as count FROM librarian_functions WHERE file_path = ?')
      .get(fileResult.value) as { count?: number } | undefined;
    const moduleRow = db
      .prepare('SELECT COUNT(*) as count FROM librarian_modules WHERE path = ?')
      .get(fileResult.value) as { count?: number } | undefined;
    const embeddingRow = db
      .prepare('SELECT COUNT(*) as count FROM librarian_embeddings WHERE entity_id IN (SELECT id FROM librarian_functions WHERE file_path = ?)')
      .get(fileResult.value) as { count?: number } | undefined;
    const moduleEmbeddingRow = db
      .prepare('SELECT COUNT(*) as count FROM librarian_embeddings WHERE entity_id IN (SELECT id FROM librarian_modules WHERE path = ?)')
      .get(fileResult.value) as { count?: number } | undefined;
    const packRow = db
      .prepare('SELECT COUNT(*) as count FROM librarian_context_packs WHERE related_files LIKE ?')
      .get(`%\"${fileResult.value}\"%`) as { count?: number } | undefined;
    return {
      functions: functionRow?.count ?? 0,
      modules: moduleRow?.count ?? 0,
      embeddings: embeddingRow?.count ?? 0,
      moduleEmbeddings: moduleEmbeddingRow?.count ?? 0,
      contextPacks: packRow?.count ?? 0,
    };
  }

  async touchFileAccess(filePath: string, accessedAt: string = new Date().toISOString()): Promise<void> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);
    const timeResult = this.sanitizeString(accessedAt);
    if (!fileResult.value) return;
    const functionUpdate = db
      .prepare('UPDATE librarian_functions SET last_accessed = ?, access_count = access_count + 1 WHERE file_path = ?')
      .run(timeResult.value, fileResult.value);
    const moduleUpdate = db
      .prepare('UPDATE librarian_modules SET updated_at = ? WHERE path = ?')
      .run(timeResult.value, fileResult.value);
    if (functionUpdate.changes + moduleUpdate.changes === 0) {
      logWarning('librarian.touchFileAccess: no rows updated', { filePath: fileResult.value });
    }
    await this.recordRedactions(mergeRedactionCounts(fileResult.counts, timeResult.counts));
  }

  async setFileChecksum(
    filePath: string,
    checksum: string,
    updatedAt: string = new Date().toISOString()
  ): Promise<void> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);
    const checksumResult = this.sanitizeString(checksum);
    const updatedResult = this.sanitizeString(updatedAt);
    let counts = mergeRedactionCounts(fileResult.counts, checksumResult.counts);
    counts = mergeRedactionCounts(counts, updatedResult.counts);
    db.prepare(`
      INSERT INTO librarian_file_checksums (file_path, checksum, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        checksum = excluded.checksum,
        updated_at = excluded.updated_at
    `).run(fileResult.value, checksumResult.value, updatedResult.value);
    await this.recordRedactions(counts);
  }

  async deleteFileChecksum(filePath: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_file_checksums WHERE file_path = ?').run(filePath);
  }

  // --------------------------------------------------------------------------
  // Graph edges (call/import graphs)
  // --------------------------------------------------------------------------

  async upsertGraphEdges(edges: GraphEdge[]): Promise<void> {
    if (!edges.length) return;
    const db = this.ensureDb();
    const insert = db.prepare(
      `INSERT INTO librarian_graph_edges
        (from_id, from_type, to_id, to_type, edge_type, source_file, source_line, confidence, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(from_id, to_id, edge_type, source_file) DO UPDATE SET
         from_type = excluded.from_type,
         to_type = excluded.to_type,
         source_line = excluded.source_line,
         confidence = excluded.confidence,
         computed_at = excluded.computed_at`
    );
    let totalCounts = createEmptyRedactionCounts();
    const tx = db.transaction((entries: GraphEdge[]) => {
      for (const edge of entries) {
        const fromId = this.sanitizeString(edge.fromId);
        const toId = this.sanitizeString(edge.toId);
        const fromType = this.sanitizeString(edge.fromType);
        const toType = this.sanitizeString(edge.toType);
        const edgeType = this.sanitizeString(edge.edgeType);
        const sourceFile = this.sanitizeString(edge.sourceFile);
        const computedAt = this.sanitizeString(edge.computedAt.toISOString());
        let counts = createEmptyRedactionCounts();
        counts = mergeRedactionCounts(counts, fromId.counts);
        counts = mergeRedactionCounts(counts, toId.counts);
        counts = mergeRedactionCounts(counts, fromType.counts);
        counts = mergeRedactionCounts(counts, toType.counts);
        counts = mergeRedactionCounts(counts, edgeType.counts);
        counts = mergeRedactionCounts(counts, sourceFile.counts);
        counts = mergeRedactionCounts(counts, computedAt.counts);
        totalCounts = mergeRedactionCounts(totalCounts, counts);
        insert.run(
          fromId.value,
          fromType.value,
          toId.value,
          toType.value,
          edgeType.value,
          sourceFile.value,
          edge.sourceLine ?? null,
          edge.confidence,
          computedAt.value
        );
      }
    });
    tx(edges);
    await this.recordRedactions(totalCounts);
  }

  async deleteGraphEdgesForSource(sourceFile: string): Promise<void> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(sourceFile);
    db.prepare('DELETE FROM librarian_graph_edges WHERE source_file = ?').run(fileResult.value);
    await this.recordRedactions(fileResult.counts);
  }

  async getGraphEdges(options: GraphEdgeQueryOptions = {}): Promise<GraphEdge[]> {
    const db = this.ensureDb();
    const filters: string[] = [];
    const params: unknown[] = [];
    const edgeTypes = Array.from(new Set([
      ...(options.edgeTypes ?? []),
      ...(options.edgeType ? [options.edgeType] : []),
    ]));

    if (options.sourceFiles?.length) {
      const placeholders = options.sourceFiles.map(() => '?').join(', ');
      filters.push(`source_file IN (${placeholders})`);
      params.push(...options.sourceFiles);
    }
    if (options.fromIds?.length) {
      const placeholders = options.fromIds.map(() => '?').join(', ');
      filters.push(`from_id IN (${placeholders})`);
      params.push(...options.fromIds);
    }
    if (options.toIds?.length) {
      const placeholders = options.toIds.map(() => '?').join(', ');
      filters.push(`to_id IN (${placeholders})`);
      params.push(...options.toIds);
    }
    if (edgeTypes.length) {
      const placeholders = edgeTypes.map(() => '?').join(', ');
      filters.push(`edge_type IN (${placeholders})`);
      params.push(...edgeTypes);
    }
    if (options.fromTypes?.length) {
      const placeholders = options.fromTypes.map(() => '?').join(', ');
      filters.push(`from_type IN (${placeholders})`);
      params.push(...options.fromTypes);
    }
    if (options.toTypes?.length) {
      const placeholders = options.toTypes.map(() => '?').join(', ');
      filters.push(`to_type IN (${placeholders})`);
      params.push(...options.toTypes);
    }

    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const limit = options.limit ? ` LIMIT ${options.limit}` : '';
    const rows = db.prepare(`SELECT * FROM librarian_graph_edges${where}${limit}`).all(...params) as {
      from_id: string;
      from_type: string;
      to_id: string;
      to_type: string;
      edge_type: string;
      source_file: string;
      source_line: number | null;
      confidence: number;
      computed_at: string;
    }[];

    return rows.map((row) => ({
      fromId: row.from_id,
      fromType: row.from_type as GraphEdge['fromType'],
      toId: row.to_id,
      toType: row.to_type as GraphEdge['toType'],
      edgeType: row.edge_type as GraphEdge['edgeType'],
      sourceFile: row.source_file,
      sourceLine: row.source_line ?? null,
      confidence: row.confidence,
      computedAt: new Date(row.computed_at),
    }));
  }

  // --------------------------------------------------------------------------
  // Dependency Invalidation
  // --------------------------------------------------------------------------

  /**
   * Invalidate cached query results for a file.
   * Removes query cache entries that reference the given file path.
   *
   * @param filePath - The file whose cache should be invalidated
   * @returns Number of cache entries invalidated
   */
  async invalidateCache(filePath: string): Promise<number> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);

    // Invalidate query cache entries that contain this file path in their params
    // Query params are stored as JSON, so we search for the file path within
    const result = db.prepare(`
      DELETE FROM librarian_query_cache
      WHERE query_params LIKE ?
    `).run(`%${fileResult.value}%`);

    // Also invalidate context packs that have this file in their related files
    const packResult = db.prepare(`
      UPDATE librarian_context_packs
      SET invalidated = 1
      WHERE related_files LIKE ?
    `).run(`%${fileResult.value}%`);

    await this.recordRedactions(fileResult.counts);
    return result.changes + packResult.changes;
  }

  /**
   * Invalidate embeddings for entities in a file.
   * Marks embeddings as stale by deleting them (they will be regenerated on next access).
   *
   * @param filePath - The file whose embeddings should be invalidated
   * @returns Number of embeddings invalidated
   */
  async invalidateEmbeddings(filePath: string): Promise<number> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);

    // Get function IDs for this file
    const functionIds = db.prepare(`
      SELECT id FROM librarian_functions WHERE file_path = ?
    `).all(fileResult.value) as { id: string }[];

    // Get module ID for this file (module path == file path)
    const moduleIds = db.prepare(`
      SELECT id FROM librarian_modules WHERE path = ?
    `).all(fileResult.value) as { id: string }[];

    // Delete embeddings for these entities
    let deletedCount = 0;
    const deleteEmbed = db.prepare('DELETE FROM librarian_embeddings WHERE entity_id = ?');
    const deleteMultiVector = db.prepare('DELETE FROM librarian_multi_vectors WHERE entity_id = ?');

    db.transaction(() => {
      for (const { id } of functionIds) {
        const result1 = deleteEmbed.run(id);
        const result2 = deleteMultiVector.run(id);
        deletedCount += result1.changes + result2.changes;
      }
      for (const { id } of moduleIds) {
        const result1 = deleteEmbed.run(id);
        const result2 = deleteMultiVector.run(id);
        deletedCount += result1.changes + result2.changes;
      }
    })();

    this.markVectorIndexDirty();
    await this.recordRedactions(fileResult.counts);
    return deletedCount;
  }

  /**
   * Get files that import the given file (reverse dependencies).
   *
   * @param filePath - The file to find importers for
   * @returns Array of file paths that import the given file
   */
  async getReverseDependencies(filePath: string): Promise<string[]> {
    const db = this.ensureDb();
    const fileResult = this.sanitizeString(filePath);

    // Find all files that have an "imports" edge pointing to this file
    const rows = db.prepare(`
      SELECT DISTINCT source_file
      FROM librarian_graph_edges
      WHERE edge_type = 'imports' AND to_id = ?
    `).all(fileResult.value) as { source_file: string }[];

    await this.recordRedactions(fileResult.counts);
    return rows.map((row) => row.source_file);
  }

  // --------------------------------------------------------------------------
  // Embeddings
  // --------------------------------------------------------------------------

  async getEmbedding(entityId: string): Promise<Float32Array | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT embedding FROM librarian_embeddings WHERE entity_id = ?')
      .get(entityId) as { embedding: Buffer } | undefined;

    if (!row) return noResult();
    const view = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.length / 4
    );
    return new Float32Array(view);
  }

  async setEmbedding(
    entityId: string,
    embedding: Float32Array,
    metadata: EmbeddingMetadata
  ): Promise<void> {
    const db = this.ensureDb();
    const now = metadata.generatedAt ?? new Date().toISOString();
    if (embedding.length === 0 || embedding.byteLength === 0 || embedding.buffer.byteLength === 0) {
      throw new Error('unverified_by_trace(provider_invalid_output): embedding buffer is empty');
    }
    const { normSq, hasNonFinite } = inspectEmbeddingVectorValues(embedding);
    if (hasNonFinite) {
      throw new Error('unverified_by_trace(provider_invalid_output): embedding contains non-finite values');
    }
    if (normSq <= EMBEDDING_INVALID_NORM_TOLERANCE) {
      throw new Error('unverified_by_trace(provider_invalid_output): embedding has zero norm');
    }
    const buffer = Buffer.allocUnsafe(embedding.length * 4);
    const view = new Float32Array(buffer.buffer, buffer.byteOffset, embedding.length);
    view.set(embedding);
    const modelIdResult = this.sanitizeString(metadata.modelId);
    const entityTypeResult = this.sanitizeString(metadata.entityType ?? 'function');
    const generatedAtResult = this.sanitizeString(now);
    let counts = mergeRedactionCounts(modelIdResult.counts, entityTypeResult.counts);
    counts = mergeRedactionCounts(counts, generatedAtResult.counts);
    const tokenCount = metadata.tokenCount ?? 0;

    db.prepare(`
      INSERT INTO librarian_embeddings (entity_id, entity_type, embedding, model_id, generated_at, token_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        embedding = excluded.embedding,
        entity_type = excluded.entity_type,
        model_id = excluded.model_id,
        generated_at = excluded.generated_at,
        token_count = excluded.token_count
      WHERE librarian_embeddings.generated_at IS NULL
        OR librarian_embeddings.generated_at < excluded.generated_at
    `).run(
      entityId,
      entityTypeResult.value as EmbeddingMetadata['entityType'],
      buffer,
      modelIdResult.value,
      generatedAtResult.value,
      tokenCount
    );
    await this.recordRedactions(counts);
    this.markVectorIndexDirty();
  }

  /**
   * Clear embeddings that don't match the expected dimension.
   * Used for auto-recovery when embedding model changes.
   *
   * @param expectedDimension - The expected embedding dimension (e.g., 384 for sentence-transformers)
   * @returns Number of embeddings deleted
   */
  async clearMismatchedEmbeddings(expectedDimension: number): Promise<number> {
    const db = this.ensureDb();
    const expectedBytes = expectedDimension * Float32Array.BYTES_PER_ELEMENT;

    // Delete embeddings where byte length doesn't match expected dimension
    const result = db.prepare(`
      DELETE FROM librarian_embeddings WHERE length(embedding) != ?
    `).run(expectedBytes);

    // Also clear multi-vectors with mismatched dimensions
    // Multi-vectors store dimension in the payload, so we need to check each one
    const multiVectorRows = db.prepare(`
      SELECT entity_id, entity_type, payload FROM librarian_multi_vectors
    `).all() as Array<{ entity_id: string; entity_type: string; payload: string }>;

    let multiVectorDeleted = 0;
    const deleteMultiVector = db.prepare(
      'DELETE FROM librarian_multi_vectors WHERE entity_id = ? AND entity_type = ?'
    );

    db.transaction(() => {
      for (const row of multiVectorRows) {
        try {
          const payload = JSON.parse(row.payload) as { summary?: { embedding?: number[] } };
          // Check if the summary embedding dimension matches
          if (payload.summary?.embedding && payload.summary.embedding.length !== expectedDimension) {
            deleteMultiVector.run(row.entity_id, row.entity_type);
            multiVectorDeleted++;
          }
        } catch {
          // If we can't parse the payload, skip this row
        }
      }
    })();

    const totalDeleted = result.changes + multiVectorDeleted;

    if (totalDeleted > 0) {
      this.markVectorIndexDirty();
      logWarning('[librarian] Cleared mismatched embeddings for auto-recovery', {
        expectedDimension,
        embeddingsDeleted: result.changes,
        multiVectorsDeleted: multiVectorDeleted,
      });
    }

    return totalDeleted;
  }

  /**
   * Get embedding statistics for diagnostics.
   * Returns counts of embeddings grouped by dimension.
   */
  async getEmbeddingStats(): Promise<{ dimension: number; count: number }[]> {
    const db = this.ensureDb();

    const rows = db.prepare(`
      SELECT length(embedding) / 4 as dimension, COUNT(*) as count
      FROM librarian_embeddings
      GROUP BY length(embedding)
      ORDER BY count DESC
    `).all() as Array<{ dimension: number; count: number }>;

    return rows;
  }

  async inspectEmbeddingIntegrity(options: { normTolerance?: number; sampleLimit?: number } = {}): Promise<{
    totalEmbeddings: number;
    invalidEmbeddings: number;
    sampleEntityIds: string[];
  }> {
    const db = this.ensureDb();
    const tolerance = options.normTolerance ?? EMBEDDING_INVALID_NORM_TOLERANCE;
    const sampleLimit = Math.max(1, options.sampleLimit ?? 20);
    const rows = db.prepare('SELECT entity_id, embedding FROM librarian_embeddings').all() as Array<{
      entity_id: string;
      embedding: Buffer;
    }>;
    const sampleEntityIds: string[] = [];
    let invalidEmbeddings = 0;
    for (const row of rows) {
      const view = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.length / Float32Array.BYTES_PER_ELEMENT
      );
      const { normSq, hasNonFinite } = inspectEmbeddingVectorValues(view);
      if (hasNonFinite || normSq <= tolerance) {
        invalidEmbeddings += 1;
        if (sampleEntityIds.length < sampleLimit) {
          sampleEntityIds.push(row.entity_id);
        }
      }
    }

    return {
      totalEmbeddings: rows.length,
      invalidEmbeddings,
      sampleEntityIds,
    };
  }

  async purgeInvalidEmbeddings(options: { normTolerance?: number; sampleLimit?: number } = {}): Promise<{
    removedEmbeddings: number;
    removedMultiVectors: number;
    sampleEntityIds: string[];
  }> {
    const db = this.ensureDb();
    const tolerance = options.normTolerance ?? EMBEDDING_INVALID_NORM_TOLERANCE;
    const sampleLimit = Math.max(1, options.sampleLimit ?? 20);
    const rows = db.prepare('SELECT entity_id, embedding FROM librarian_embeddings').all() as Array<{
      entity_id: string;
      embedding: Buffer;
    }>;
    const invalidEntityIds: string[] = [];
    const sampleEntityIds: string[] = [];
    for (const row of rows) {
      const view = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.length / Float32Array.BYTES_PER_ELEMENT
      );
      const { normSq, hasNonFinite } = inspectEmbeddingVectorValues(view);
      if (hasNonFinite || normSq <= tolerance) {
        invalidEntityIds.push(row.entity_id);
        if (sampleEntityIds.length < sampleLimit) {
          sampleEntityIds.push(row.entity_id);
        }
      }
    }

    if (invalidEntityIds.length === 0) {
      return {
        removedEmbeddings: 0,
        removedMultiVectors: 0,
        sampleEntityIds,
      };
    }

    const deleteEmbedding = db.prepare('DELETE FROM librarian_embeddings WHERE entity_id = ?');
    const deleteMultiVector = db.prepare('DELETE FROM librarian_multi_vectors WHERE entity_id = ?');
    const result = db.transaction(() => {
      let removedEmbeddings = 0;
      let removedMultiVectors = 0;
      for (const entityId of invalidEntityIds) {
        removedEmbeddings += deleteEmbedding.run(entityId).changes;
        removedMultiVectors += deleteMultiVector.run(entityId).changes;
      }
      return { removedEmbeddings, removedMultiVectors };
    })();

    if (result.removedEmbeddings > 0 || result.removedMultiVectors > 0) {
      this.markVectorIndexDirty();
    }

    return {
      removedEmbeddings: result.removedEmbeddings,
      removedMultiVectors: result.removedMultiVectors,
      sampleEntityIds,
    };
  }

  async findSimilarByEmbedding(
    queryEmbedding: Float32Array,
    options: SimilaritySearchOptions
  ): Promise<SimilaritySearchResponse> {
    const index = this.ensureVectorIndex();
    const db = this.ensureDb();
    const expectedBytes = queryEmbedding.length * Float32Array.BYTES_PER_ELEMENT;
    const filter = options.filter;
    const requiresSqlFilterPushdown = Boolean(
      filter
      && (
        filter.pathPrefix
        || filter.language
        || typeof filter.isExported === 'boolean'
        || typeof filter.isPure === 'boolean'
        || filter.excludeTests
      )
    );
    const pathExpr = "lower(coalesce(f.file_path, m.path, CASE WHEN e.entity_type = 'document' THEN substr(e.entity_id, 5) ELSE '' END))";
    const filterParams: unknown[] = [];
    const whereClauses: string[] = [];

    if (options.entityTypes?.length) {
      whereClauses.push(`e.entity_type IN (${options.entityTypes.map(() => '?').join(',')})`);
      filterParams.push(...options.entityTypes);
    }

    if (requiresSqlFilterPushdown) {
      const pathPrefixes = normalizeFilterPathPrefix(filter?.pathPrefix, this.workspaceRoot);
      if (pathPrefixes.length > 0) {
        whereClauses.push(`(${pathPrefixes.map(() => `${pathExpr} LIKE ?`).join(' OR ')})`);
        filterParams.push(...pathPrefixes.map((prefix) => `${prefix}%`));
      }

      const languageExtensions = normalizeLanguageExtensions(filter?.language);
      if (languageExtensions.length > 0) {
        whereClauses.push(`(${languageExtensions.map(() => `${pathExpr} LIKE ?`).join(' OR ')})`);
        filterParams.push(...languageExtensions.map((extension) => `%${extension}`));
      }

      if (filter?.excludeTests) {
        const testPatterns = ['%/__tests__/%', '%.test.%', '%.spec.%', '%/test/%', '%/tests/%'];
        whereClauses.push(`NOT (${testPatterns.map(() => `${pathExpr} LIKE ?`).join(' OR ')})`);
        filterParams.push(...testPatterns);
      }

      if (typeof filter?.isExported === 'boolean') {
        whereClauses.push(`
          CASE
            WHEN e.entity_type = 'module' THEN json_array_length(m.exports) > 0
            WHEN e.entity_type = 'function' THEN (lower(f.signature) LIKE 'export %' OR lower(f.signature) LIKE '% export %')
            ELSE 0
          END = ?
        `);
        filterParams.push(filter.isExported ? 1 : 0);
      }

      if (typeof filter?.isPure === 'boolean') {
        whereClauses.push(`
          CASE
            WHEN e.entity_type = 'function' THEN coalesce(f.is_pure, 0)
            ELSE 0
          END = ?
        `);
        filterParams.push(filter.isPure ? 1 : 0);
      }
    }

    const joins = requiresSqlFilterPushdown
      ? ' LEFT JOIN librarian_functions f ON e.entity_type = \'function\' AND f.id = e.entity_id'
        + ' LEFT JOIN librarian_modules m ON e.entity_type = \'module\' AND m.id = e.entity_id'
      : '';
    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total, SUM(CASE WHEN length(e.embedding) = ? THEN 1 ELSE 0 END) as matching FROM librarian_embeddings e${joins}${whereSql}`;
    const countRow = db.prepare(countSql).get(
      expectedBytes,
      ...filterParams,
    ) as { total: number; matching: number | null } | undefined;
    const totalEmbeddings = countRow?.total ?? 0;
    const matchingEmbeddings = Number(countRow?.matching ?? 0);

    // Track degradation state
    let degraded = false;
    let degradedReason: SimilaritySearchResponse['degradedReason'];
    let clearedMismatchedCount: number | undefined;

    // Handle complete dimension mismatch
    if (totalEmbeddings > 0 && matchingEmbeddings === 0) {
      if (options.autoRecoverDimensionMismatch) {
        // Auto-recovery: clear mismatched embeddings and return degraded results
        clearedMismatchedCount = await this.clearMismatchedEmbeddings(queryEmbedding.length);
        logWarning('[librarian] Auto-recovered from dimension mismatch by clearing embeddings', {
          expectedDimension: queryEmbedding.length,
          clearedCount: clearedMismatchedCount,
        });
        degraded = true;
        degradedReason = 'auto_recovered_dimension_mismatch';
        // Return empty results since all embeddings were cleared
        return { results: [], degraded, degradedReason, clearedMismatchedCount };
      } else {
        throw new Error(
          `unverified_by_trace(embedding_dimension_mismatch): stored embeddings do not match ` +
          `query dimension ${queryEmbedding.length}. Re-index embeddings to ${queryEmbedding.length} dimensions.`
        );
      }
    }

    if (totalEmbeddings > matchingEmbeddings) {
      logWarning('[librarian] Skipping embeddings with dimension mismatch', {
        expectedDimension: queryEmbedding.length,
        totalEmbeddings,
        matchingEmbeddings,
      });
      degraded = true;
      degradedReason = 'dimension_mismatch';
    }

    // Check for empty/null vector index (degraded state)
    if (!index) {
      logWarning('[librarian] findSimilarByEmbedding: vector index is null', {
        queryDimension: queryEmbedding.length,
      });
      degraded = true;
      degradedReason = 'vector_index_null';
    } else if (index.size() === 0) {
      logWarning('[librarian] findSimilarByEmbedding: vector index is empty', {
        queryDimension: queryEmbedding.length,
      });
      degraded = true;
      degradedReason = 'vector_index_empty';
    }

    // Use optimized HNSW index if available and has matching dimensions
    if (!requiresSqlFilterPushdown && index && index.size() > 0 && index.hasDimension(queryEmbedding.length)) {
      const results = index.search(queryEmbedding, options);
      const fileSizeFiltered = await this.applySimilarityFileSizeFilter(results, filter?.maxFileSizeBytes);
      return { results: fileSizeFiltered.slice(0, options.limit), degraded, degradedReason };
    }

    // Fallback to brute-force SQL search (always degraded)
    if (!degraded) {
      degraded = true;
      degradedReason = 'fallback_to_brute_force';
    }
    const sql = `SELECT e.entity_id, e.entity_type, e.embedding FROM librarian_embeddings e${joins}${whereSql}${whereClauses.length > 0 ? ' AND' : ' WHERE'} length(e.embedding) = ?`;
    const rows = db.prepare(sql).all(
      ...filterParams,
      expectedBytes,
    ) as Array<{
      entity_id: string;
      entity_type: string;
      embedding: Buffer;
    }>;

    const results: SimilarityResult[] = [];

    for (const row of rows) {
      const storedEmbedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.length / 4
      );

      const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);

      if (similarity >= options.minSimilarity) {
        results.push({
          entityId: row.entity_id,
          entityType: row.entity_type as 'function' | 'module' | 'document',
          similarity,
        });
      }
    }

    // Sort by similarity descending and limit
    results.sort((a, b) => b.similarity - a.similarity);
    const fileSizeFiltered = await this.applySimilarityFileSizeFilter(results, filter?.maxFileSizeBytes);
    return { results: fileSizeFiltered.slice(0, options.limit), degraded, degradedReason };
  }

  private async applySimilarityFileSizeFilter(
    results: SimilarityResult[],
    maxFileSizeBytes: number | undefined,
  ): Promise<SimilarityResult[]> {
    if (typeof maxFileSizeBytes !== 'number' || !Number.isFinite(maxFileSizeBytes) || maxFileSizeBytes <= 0) {
      return results;
    }
    if (!this.workspaceRoot) return results;

    const filtered: SimilarityResult[] = [];
    for (const result of results) {
      const candidatePath = this.resolveSimilarityResultPath(result);
      if (!candidatePath) {
        filtered.push(result);
        continue;
      }
      const absolutePath = path.isAbsolute(candidatePath)
        ? candidatePath
        : path.resolve(this.workspaceRoot, candidatePath);
      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isFile() && stat.size <= maxFileSizeBytes) {
          filtered.push(result);
        }
      } catch {
        // Unknown size/path should not suppress relevant results.
        filtered.push(result);
      }
    }
    return filtered;
  }

  private resolveSimilarityResultPath(result: SimilarityResult): string | null {
    const db = this.ensureDb();
    if (result.entityType === 'function') {
      const row = db.prepare('SELECT file_path FROM librarian_functions WHERE id = ?').get(result.entityId) as { file_path?: string } | undefined;
      return typeof row?.file_path === 'string' ? row.file_path : null;
    }
    if (result.entityType === 'module') {
      const row = db.prepare('SELECT path FROM librarian_modules WHERE id = ?').get(result.entityId) as { path?: string } | undefined;
      return typeof row?.path === 'string' ? row.path : null;
    }
    if (result.entityType === 'document') {
      return result.entityId.startsWith('doc:') ? result.entityId.slice(4) : result.entityId;
    }
    return null;
  }

  async getMultiVector(entityId: string, entityType?: 'function' | 'module'): Promise<MultiVectorRecord | null> {
    const db = this.ensureDb();
    const row = entityType
      ? db.prepare('SELECT * FROM librarian_multi_vectors WHERE entity_id = ? AND entity_type = ?').get(entityId, entityType)
      : db.prepare('SELECT * FROM librarian_multi_vectors WHERE entity_id = ?').get(entityId);
    if (!row) return noResult();
    const parsed = safeJsonParse<MultiVectorRecord['payload']>((row as { payload: string }).payload);
    if (!parsed.ok) {
      const message = getResultErrorMessage(parsed) || 'invalid payload';
      throw new Error(`unverified_by_trace(storage_corrupt): invalid multi-vector payload (${message})`);
    }
    const typed = row as {
      entity_id: string;
      entity_type: string;
      payload: string;
      model_id: string;
      generated_at: string;
      token_count: number;
    };
    return {
      entityId: typed.entity_id,
      entityType: typed.entity_type as MultiVectorRecord['entityType'],
      payload: parsed.value,
      modelId: typed.model_id,
      generatedAt: typed.generated_at,
      tokenCount: typed.token_count,
    };
  }

  async getMultiVectors(options: MultiVectorQueryOptions = {}): Promise<MultiVectorRecord[]> {
    const db = this.ensureDb();
    const filters: string[] = [];
    const params: unknown[] = [];
    if (options.entityIds && options.entityIds.length) {
      filters.push(`entity_id IN (${options.entityIds.map(() => '?').join(',')})`);
      params.push(...options.entityIds);
    }
    if (options.entityType) {
      filters.push('entity_type = ?');
      params.push(options.entityType);
    }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const limit = options.limit ? ` LIMIT ${options.limit}` : '';
    const rows = db.prepare(`SELECT * FROM librarian_multi_vectors${where}${limit}`).all(...params) as {
      entity_id: string;
      entity_type: string;
      payload: string;
      model_id: string;
      generated_at: string;
      token_count: number;
    }[];
    const results: MultiVectorRecord[] = [];
    for (const row of rows) {
      const parsed = safeJsonParse<MultiVectorRecord['payload']>(row.payload);
      if (!parsed.ok) {
        const message = getResultErrorMessage(parsed) || 'invalid payload';
        throw new Error(`unverified_by_trace(storage_corrupt): invalid multi-vector payload (${message})`);
      }
      results.push({
        entityId: row.entity_id,
        entityType: row.entity_type as MultiVectorRecord['entityType'],
        payload: parsed.value,
        modelId: row.model_id,
        generatedAt: row.generated_at,
        tokenCount: row.token_count,
      });
    }
    return results;
  }

  async upsertMultiVector(record: MultiVectorRecord): Promise<void> {
    const db = this.ensureDb();
    const payload = JSON.stringify(record.payload);
    const modelIdResult = this.sanitizeString(record.modelId);
    const entityTypeResult = this.sanitizeString(record.entityType);
    const generatedAtResult = this.sanitizeString(record.generatedAt);
    let counts = mergeRedactionCounts(modelIdResult.counts, entityTypeResult.counts);
    counts = mergeRedactionCounts(counts, generatedAtResult.counts);
    db.prepare(`
      INSERT INTO librarian_multi_vectors (entity_id, entity_type, payload, model_id, generated_at, token_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id, entity_type) DO UPDATE SET
        payload = excluded.payload,
        model_id = excluded.model_id,
        generated_at = excluded.generated_at,
        token_count = excluded.token_count
      WHERE librarian_multi_vectors.generated_at IS NULL
        OR librarian_multi_vectors.generated_at < excluded.generated_at
    `).run(
      record.entityId,
      entityTypeResult.value,
      payload,
      modelIdResult.value,
      generatedAtResult.value,
      record.tokenCount
    );
    await this.recordRedactions(counts);
  }

  // --------------------------------------------------------------------------
  // Query Cache
  // --------------------------------------------------------------------------

  async getQueryCacheEntry(queryHash: string): Promise<QueryCacheEntry | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT query_hash, query_params, response, created_at, last_accessed, access_count FROM librarian_query_cache WHERE query_hash = ?')
      .get(queryHash) as QueryCacheRow | undefined;
    if (!row?.query_hash) return noResult();
    return {
      queryHash: row.query_hash,
      queryParams: row.query_params,
      response: row.response,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    };
  }

  async getRecentQueryCacheEntries(limit: number): Promise<QueryCacheEntry[]> {
    const db = this.ensureDb();
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 120;
    const rows = db
      .prepare('SELECT query_hash, query_params, response, created_at, last_accessed, access_count FROM librarian_query_cache ORDER BY last_accessed DESC LIMIT ?')
      .all(safeLimit) as QueryCacheRow[];
    return rows.map((row) => ({
      queryHash: row.query_hash,
      queryParams: row.query_params,
      response: row.response,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    }));
  }

  async upsertQueryCacheEntry(entry: QueryCacheEntry): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_query_cache (query_hash, query_params, response, created_at, last_accessed, access_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(query_hash) DO UPDATE SET
        query_params = excluded.query_params,
        response = excluded.response,
        created_at = excluded.created_at,
        last_accessed = excluded.last_accessed,
        access_count = excluded.access_count
    `).run(
      entry.queryHash,
      entry.queryParams,
      entry.response,
      entry.createdAt,
      entry.lastAccessed,
      entry.accessCount
    );
  }

  async recordQueryCacheAccess(queryHash: string): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE librarian_query_cache SET access_count = access_count + 1, last_accessed = ? WHERE query_hash = ?')
      .run(now, queryHash);
  }

  async pruneQueryCache(options: QueryCachePruneOptions): Promise<number> {
    const db = this.ensureDb();
    const cutoff = new Date(Date.now() - options.maxAgeMs).toISOString();
    const expired = db.prepare('DELETE FROM librarian_query_cache WHERE last_accessed < ?').run(cutoff).changes;
    const row = db.prepare('SELECT COUNT(*) as count FROM librarian_query_cache').get() as { count?: number } | undefined;
    const count = row?.count ?? 0;
    let trimmed = 0;
    if (count > options.maxEntries) {
      const toRemove = count - options.maxEntries;
      const rows = db.prepare('SELECT query_hash FROM librarian_query_cache ORDER BY last_accessed ASC LIMIT ?').all(toRemove) as { query_hash: string }[];
      const deleteStmt = db.prepare('DELETE FROM librarian_query_cache WHERE query_hash = ?');
      for (const rowToDelete of rows) {
        deleteStmt.run(rowToDelete.query_hash);
        trimmed += 1;
      }
    }
    return expired + trimmed;
  }

  async appendRetrievalConfidenceLog(entry: RetrievalConfidenceLogEntry): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO retrieval_confidence_log (
        id,
        query_hash,
        confidence_score,
        retrieval_entropy,
        returned_pack_ids,
        timestamp,
        intent,
        from_depth,
        to_depth,
        escalation_reason,
        attempt,
        max_escalation_depth,
        routed_strategy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      entry.queryHash,
      entry.confidenceScore,
      entry.retrievalEntropy,
      JSON.stringify(entry.returnedPackIds),
      entry.timestamp,
      entry.intent ?? null,
      entry.fromDepth ?? null,
      entry.toDepth ?? null,
      entry.escalationReason ?? null,
      entry.attempt ?? null,
      entry.maxEscalationDepth ?? null,
      entry.routedStrategy ?? null,
    );
  }

  async getRetrievalConfidenceLogs(options: RetrievalConfidenceLogQueryOptions = {}): Promise<RetrievalConfidenceLogEntry[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (typeof options.queryHash === 'string' && options.queryHash.trim().length > 0) {
      clauses.push('query_hash = ?');
      params.push(options.queryHash.trim());
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(500, Math.trunc(options.limit)))
      : 20;
    const rows = db.prepare(`
      SELECT query_hash, confidence_score, retrieval_entropy, returned_pack_ids, timestamp, intent, from_depth, to_depth,
             escalation_reason, attempt, max_escalation_depth, routed_strategy
      FROM retrieval_confidence_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(...params, limit) as RetrievalConfidenceLogRow[];

    return rows.map((row) => ({
      queryHash: row.query_hash,
      confidenceScore: row.confidence_score,
      retrievalEntropy: row.retrieval_entropy,
      returnedPackIds: parseStringArray(row.returned_pack_ids),
      timestamp: row.timestamp,
      intent: row.intent ?? undefined,
      fromDepth: row.from_depth ?? undefined,
      toDepth: row.to_depth ?? undefined,
      escalationReason: row.escalation_reason ?? undefined,
      attempt: row.attempt ?? undefined,
      maxEscalationDepth: row.max_escalation_depth ?? undefined,
      routedStrategy: row.routed_strategy ?? undefined,
    }));
  }

  async getRetrievalStrategyRewards(intentType?: string): Promise<RetrievalStrategyReward[]> {
    const db = this.ensureDb();
    const normalizedIntent = typeof intentType === 'string' ? intentType.trim() : '';
    const rows = normalizedIntent.length > 0
      ? db.prepare(`
        SELECT strategy_id, intent_type, success_count, failure_count, last_updated
        FROM retrieval_strategy_rewards
        WHERE intent_type = ?
        ORDER BY strategy_id ASC
      `).all(normalizedIntent) as RetrievalStrategyRewardRow[]
      : db.prepare(`
        SELECT strategy_id, intent_type, success_count, failure_count, last_updated
        FROM retrieval_strategy_rewards
        ORDER BY intent_type ASC, strategy_id ASC
      `).all() as RetrievalStrategyRewardRow[];

    return rows.map((row) => ({
      strategyId: row.strategy_id,
      intentType: row.intent_type,
      successCount: row.success_count,
      failureCount: row.failure_count,
      lastUpdated: row.last_updated,
    }));
  }

  async recordRetrievalStrategySelection(selection: RetrievalStrategySelection): Promise<void> {
    const db = this.ensureDb();
    const createdAt = selection.createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO retrieval_strategy_queries (
        query_id,
        strategy_id,
        intent_type,
        created_at,
        feedback_outcome,
        feedback_recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(query_id) DO UPDATE SET
        strategy_id = excluded.strategy_id,
        intent_type = excluded.intent_type,
        created_at = excluded.created_at
    `).run(
      selection.queryId,
      selection.strategyId,
      selection.intentType,
      createdAt,
      selection.feedbackOutcome ?? null,
      selection.feedbackRecordedAt ?? null,
    );

    db.prepare(`
      INSERT INTO retrieval_strategy_rewards (strategy_id, intent_type, success_count, failure_count, last_updated)
      VALUES (?, ?, 0, 0, ?)
      ON CONFLICT(strategy_id, intent_type) DO NOTHING
    `).run(selection.strategyId, selection.intentType, createdAt);
  }

  async getRetrievalStrategySelection(queryId: string): Promise<RetrievalStrategySelection | null> {
    const db = this.ensureDb();
    const row = db.prepare(`
      SELECT query_id, strategy_id, intent_type, created_at, feedback_outcome, feedback_recorded_at
      FROM retrieval_strategy_queries
      WHERE query_id = ?
      LIMIT 1
    `).get(queryId) as RetrievalStrategySelectionRow | undefined;
    if (!row) return null;
    return {
      queryId: row.query_id,
      strategyId: row.strategy_id,
      intentType: row.intent_type,
      createdAt: row.created_at,
      feedbackOutcome: row.feedback_outcome ?? undefined,
      feedbackRecordedAt: row.feedback_recorded_at ?? undefined,
    };
  }

  async applyRetrievalStrategyFeedback(
    queryId: string,
    wasHelpful: boolean,
    outcome: 'success' | 'failure' | 'partial' = wasHelpful ? 'success' : 'failure'
  ): Promise<RetrievalStrategyReward | null> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const update = db.transaction((id: string): RetrievalStrategyReward | null => {
      const selection = db.prepare(`
        SELECT query_id, strategy_id, intent_type, created_at, feedback_outcome, feedback_recorded_at
        FROM retrieval_strategy_queries
        WHERE query_id = ?
        LIMIT 1
      `).get(id) as RetrievalStrategySelectionRow | undefined;
      if (!selection) return null;

      db.prepare(`
        INSERT INTO retrieval_strategy_rewards (strategy_id, intent_type, success_count, failure_count, last_updated)
        VALUES (?, ?, 0, 0, ?)
        ON CONFLICT(strategy_id, intent_type) DO NOTHING
      `).run(selection.strategy_id, selection.intent_type, now);

      if (!selection.feedback_outcome) {
        if (wasHelpful) {
          db.prepare(`
            UPDATE retrieval_strategy_rewards
            SET success_count = success_count + 1, last_updated = ?
            WHERE strategy_id = ? AND intent_type = ?
          `).run(now, selection.strategy_id, selection.intent_type);
        } else {
          db.prepare(`
            UPDATE retrieval_strategy_rewards
            SET failure_count = failure_count + 1, last_updated = ?
            WHERE strategy_id = ? AND intent_type = ?
          `).run(now, selection.strategy_id, selection.intent_type);
        }

        db.prepare(`
          UPDATE retrieval_strategy_queries
          SET feedback_outcome = ?, feedback_recorded_at = ?
          WHERE query_id = ?
        `).run(outcome, now, id);
      }

      const rewardRow = db.prepare(`
        SELECT strategy_id, intent_type, success_count, failure_count, last_updated
        FROM retrieval_strategy_rewards
        WHERE strategy_id = ? AND intent_type = ?
        LIMIT 1
      `).get(selection.strategy_id, selection.intent_type) as RetrievalStrategyRewardRow | undefined;
      if (!rewardRow) return null;
      return {
        strategyId: rewardRow.strategy_id,
        intentType: rewardRow.intent_type,
        successCount: rewardRow.success_count,
        failureCount: rewardRow.failure_count,
        lastUpdated: rewardRow.last_updated,
      };
    });
    return update(queryId);
  }

  async getRetrievalStrategySelections(
    options: RetrievalStrategySelectionQueryOptions = {}
  ): Promise<RetrievalStrategySelection[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (typeof options.intentType === 'string' && options.intentType.trim().length > 0) {
      clauses.push('intent_type = ?');
      params.push(options.intentType.trim());
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(1000, Math.trunc(options.limit)))
      : 200;
    const rows = db.prepare(`
      SELECT query_id, strategy_id, intent_type, created_at, feedback_outcome, feedback_recorded_at
      FROM retrieval_strategy_queries
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit) as RetrievalStrategySelectionRow[];

    return rows.map((row) => ({
      queryId: row.query_id,
      strategyId: row.strategy_id,
      intentType: row.intent_type,
      createdAt: row.created_at,
      feedbackOutcome: row.feedback_outcome ?? undefined,
      feedbackRecordedAt: row.feedback_recorded_at ?? undefined,
    }));
  }

  async recordQueryAccessLogs(entries: QueryAccessLogEntry[]): Promise<void> {
    if (!entries.length) return;
    const db = this.ensureDb();
    const upsert = db.prepare(`
      INSERT INTO query_access_log (entity_id, entity_type, last_queried_at, query_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity_id, entity_type) DO UPDATE SET
        query_count = query_access_log.query_count + excluded.query_count,
        last_queried_at = CASE
          WHEN excluded.last_queried_at > query_access_log.last_queried_at THEN excluded.last_queried_at
          ELSE query_access_log.last_queried_at
        END
    `);
    const tx = db.transaction((rows: QueryAccessLogEntry[]) => {
      for (const row of rows) {
        if (row.entityType !== 'function' && row.entityType !== 'module') continue;
        if (typeof row.entityId !== 'string' || row.entityId.trim().length === 0) continue;
        const count = Math.max(1, Number.isFinite(row.queryCount) ? Math.trunc(row.queryCount) : 1);
        const timestamp = typeof row.lastQueriedAt === 'string' && row.lastQueriedAt.trim().length > 0
          ? row.lastQueriedAt
          : new Date().toISOString();
        upsert.run(row.entityId.trim(), row.entityType, timestamp, count);
      }
    });
    tx(entries);
  }

  async getQueryAccessLogs(options: QueryAccessLogQueryOptions = {}): Promise<QueryAccessLogEntry[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.entityType) {
      clauses.push('entity_type = ?');
      params.push(options.entityType);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(5000, Math.trunc(options.limit)))
      : 200;
    const rows = db.prepare(`
      SELECT entity_id, entity_type, last_queried_at, query_count
      FROM query_access_log
      ${whereClause}
      ORDER BY query_count DESC, last_queried_at DESC
      LIMIT ?
    `).all(...params, limit) as QueryAccessLogRow[];
    return rows.map((row) => ({
      entityId: row.entity_id,
      entityType: row.entity_type,
      lastQueriedAt: row.last_queried_at,
      queryCount: row.query_count,
    }));
  }

  async getExplorationSuggestions(
    options: ExplorationSuggestionQueryOptions = {}
  ): Promise<ExplorationSuggestion[]> {
    const db = this.ensureDb();
    const entityType = options.entityType ?? 'module';
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(200, Math.trunc(options.limit)))
      : 5;
    const metricRows = db.prepare(`
      SELECT
        gm.entity_id,
        gm.entity_type,
        gm.pagerank,
        gm.betweenness,
        gm.closeness,
        gm.eigenvector,
        qal.query_count,
        qal.last_queried_at
      FROM librarian_graph_metrics gm
      LEFT JOIN query_access_log qal
        ON qal.entity_id = gm.entity_id
       AND qal.entity_type = gm.entity_type
      WHERE gm.entity_type = ?
      ORDER BY gm.pagerank DESC
      LIMIT 5000
    `).all(entityType) as ExplorationMetricRow[];
    if (metricRows.length === 0) return [];

    const entityIds = metricRows.map((row) => row.entity_id);
    const dependentCounts = new Map<string, number>();
    if (entityIds.length > 0) {
      const placeholders = entityIds.map(() => '?').join(',');
      const dependentRows = db.prepare(`
        SELECT to_id AS entity_id, COUNT(*) AS dependent_count
        FROM librarian_graph_edges
        WHERE to_type = ?
          AND to_id IN (${placeholders})
        GROUP BY to_id
      `).all(entityType, ...entityIds) as ExplorationDependentRow[];
      for (const row of dependentRows) {
        dependentCounts.set(row.entity_id, row.dependent_count);
      }
    }

    const scored = metricRows
      .map((row) => {
        const queryCount = Math.max(0, row.query_count ?? 0);
        const centralityScore = (row.pagerank + row.betweenness + row.closeness + row.eigenvector) / 4;
        const denominator = Math.log(1 + Math.max(1, queryCount));
        const explorationValue = centralityScore / (denominator > 0 ? denominator : 1);
        const dependentCount = dependentCounts.get(row.entity_id) ?? 0;
        const rationale = queryCount === 0
          ? `High-centrality ${row.entity_type} has never been queried${dependentCount > 0 ? ` and has ${dependentCount} dependents` : ''}.`
          : `High-centrality ${row.entity_type} has low exploration relative to query_count=${queryCount}${dependentCount > 0 ? ` and ${dependentCount} dependents` : ''}.`;
        return {
          entityId: row.entity_id,
          entityType: row.entity_type,
          centralityScore,
          queryCount,
          explorationValue,
          lastQueriedAt: row.last_queried_at ?? undefined,
          dependentCount,
          rationale,
        };
      })
      .sort((a, b) => (b.explorationValue - a.explorationValue)
        || (b.centralityScore - a.centralityScore)
        || (a.queryCount - b.queryCount)
        || a.entityId.localeCompare(b.entityId));

    return scored.slice(0, limit);
  }

  private ensureVectorIndex(): VectorIndex | null {
    if (!this.vectorIndex) this.vectorIndex = this.createVectorIndex();
    if (!this.vectorIndexDirty) return this.vectorIndex;

    if (this.tryLoadSerializedVectorIndex(this.vectorIndex)) {
      this.vectorIndexDirty = false;
      return this.vectorIndex;
    }

    const items = this.loadVectorIndexItems();
    if (!items.length) {
      this.vectorIndex.clear();
      this.vectorIndexDirty = false;
      this.deleteSerializedVectorIndex();
      return noResult();
    }
    this.vectorIndex.load(items);
    this.persistSerializedVectorIndex(this.vectorIndex);
    this.vectorIndexDirty = false;
    return this.vectorIndex;
  }

  private createVectorIndex(): VectorIndex {
    const rawThreshold = process.env.LIBRARIAN_HNSW_AUTO_THRESHOLD;
    const parsedThreshold = rawThreshold === undefined ? Number.NaN : Number.parseInt(rawThreshold, 10);
    if (Number.isFinite(parsedThreshold) && parsedThreshold > 0) {
      return new VectorIndex({ hnswAutoThreshold: parsedThreshold });
    }
    return new VectorIndex();
  }

  private resolveSerializedVectorIndexPath(): string | null {
    if (this.dbPath === ':memory:') {
      return null;
    }
    const root = this.workspaceRoot ?? path.dirname(this.dbPath);
    return path.join(root, '.librarian', 'hnsw.bin');
  }

  private tryLoadSerializedVectorIndex(index: VectorIndex): boolean {
    const serializedPath = this.resolveSerializedVectorIndexPath();
    if (!serializedPath || !fsSync.existsSync(serializedPath)) {
      return false;
    }

    try {
      if (this.dbPath !== ':memory:' && fsSync.existsSync(this.dbPath)) {
        const serializedStat = fsSync.statSync(serializedPath);
        const dbStat = fsSync.statSync(this.dbPath);
        if (serializedStat.mtimeMs < dbStat.mtimeMs) {
          return false;
        }
      }

      const payload = fsSync.readFileSync(serializedPath);
      if (payload.length === 0) {
        return false;
      }
      index.loadSerializedHNSW(payload);
      return true;
    } catch (error) {
      logWarning('[librarian] Failed to load serialized vector index, rebuilding from SQLite', {
        path: serializedPath,
        error,
      });
      return false;
    }
  }

  private persistSerializedVectorIndex(index: VectorIndex): void {
    const serializedPath = this.resolveSerializedVectorIndexPath();
    if (!serializedPath) return;
    const payload = index.serializeHNSW();
    if (!payload || payload.length === 0) return;

    try {
      fsSync.mkdirSync(path.dirname(serializedPath), { recursive: true });
      fsSync.writeFileSync(serializedPath, payload);
    } catch (error) {
      logWarning('[librarian] Failed to persist serialized vector index', {
        path: serializedPath,
        error,
      });
    }
  }

  private deleteSerializedVectorIndex(): void {
    const serializedPath = this.resolveSerializedVectorIndexPath();
    if (!serializedPath || !fsSync.existsSync(serializedPath)) return;
    try {
      fsSync.rmSync(serializedPath, { force: true });
    } catch (error) {
      logWarning('[librarian] Failed to remove serialized vector index', {
        path: serializedPath,
        error,
      });
    }
  }

  private markVectorIndexDirty(): void {
    this.vectorIndexDirty = true;
    this.deleteSerializedVectorIndex();
  }

  private loadVectorIndexItems(): Array<{ entityId: string; entityType: EmbeddableEntityType; embedding: Float32Array }> { const db = this.ensureDb(); const rows = db.prepare('SELECT entity_id, entity_type, embedding FROM librarian_embeddings').all() as { entity_id: string; entity_type: string; embedding: Buffer; }[]; return rows.map((row) => { const view = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4); return { entityId: row.entity_id, entityType: row.entity_type as EmbeddableEntityType, embedding: new Float32Array(view) }; }); }

  // --------------------------------------------------------------------------
  // Graph Metrics
  // --------------------------------------------------------------------------

  async setGraphMetrics(entries: GraphMetricsEntry[]): Promise<void> {
    const db = this.ensureDb();
    const insert = db.prepare('INSERT INTO librarian_graph_metrics (entity_id, entity_type, pagerank, betweenness, closeness, eigenvector, community_id, is_bridge, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entity_id, entity_type) DO UPDATE SET pagerank = excluded.pagerank, betweenness = excluded.betweenness, closeness = excluded.closeness, eigenvector = excluded.eigenvector, community_id = excluded.community_id, is_bridge = excluded.is_bridge, computed_at = excluded.computed_at');
    const tx = db.transaction((rows: GraphMetricsEntry[]) => {
      db.prepare('DELETE FROM librarian_graph_metrics').run();
      for (const entry of rows) {
        insert.run(
          entry.entityId,
          entry.entityType,
          entry.pagerank,
          entry.betweenness,
          entry.closeness,
          entry.eigenvector,
          entry.communityId,
          entry.isBridge ? 1 : 0,
          entry.computedAt
        );
      }
    });
    tx(entries);
  }

  async getGraphMetrics(options: GraphMetricsQueryOptions = {}): Promise<GraphMetricsEntry[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.entityType) {
      clauses.push('entity_type = ?');
      params.push(options.entityType);
    }
    if (options.entityIds?.length) {
      clauses.push(`entity_id IN (${options.entityIds.map(() => '?').join(',')})`);
      params.push(...options.entityIds);
    }
    if (options.minPagerank !== undefined) {
      clauses.push('pagerank >= ?');
      params.push(options.minPagerank);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit ? ` LIMIT ${options.limit}` : '';
    const rows = db.prepare(`SELECT * FROM librarian_graph_metrics${where} ORDER BY pagerank DESC${limit}`).all(...params) as {
      entity_id: string;
      entity_type: GraphMetricsEntry['entityType'];
      pagerank: number;
      betweenness: number;
      closeness: number;
      eigenvector: number;
      community_id: number;
      is_bridge: number;
      computed_at: string;
    }[];
    return rows.map((row) => ({
      entityId: row.entity_id,
      entityType: row.entity_type,
      pagerank: row.pagerank,
      betweenness: row.betweenness,
      closeness: row.closeness,
      eigenvector: row.eigenvector,
      communityId: row.community_id,
      isBridge: Boolean(row.is_bridge),
      computedAt: row.computed_at,
    }));
  }

  async deleteGraphMetrics(): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_graph_metrics').run();
  }

  async setEvidence(entries: EvidenceEntry[]): Promise<void> {
    if (!entries.length) return;
    const db = this.ensureDb();
    const contentHashes = await this.computeEvidenceContentHashes(entries);
    const insert = db.prepare('INSERT INTO librarian_evidence (claim_id, entity_id, entity_type, file_path, line_start, line_end, snippet, claim, confidence, created_at, content_hash, verified_at, is_stale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(claim_id) DO UPDATE SET file_path = excluded.file_path, line_start = excluded.line_start, line_end = excluded.line_end, snippet = excluded.snippet, claim = excluded.claim, confidence = excluded.confidence, created_at = excluded.created_at, content_hash = excluded.content_hash, verified_at = excluded.verified_at, is_stale = excluded.is_stale');
    const clear = db.prepare('DELETE FROM librarian_evidence WHERE entity_id = ? AND entity_type = ?');
    let counts = createEmptyRedactionCounts();
    const tx = db.transaction((rows: EvidenceEntry[]) => {
      const cleared = new Set<string>();
      for (const entry of rows) {
        const key = `${entry.entityType}:${entry.entityId}`;
        if (!cleared.has(key)) { clear.run(entry.entityId, entry.entityType); cleared.add(key); }
        const fileResult = this.sanitizeString(entry.file); counts = mergeRedactionCounts(counts, fileResult.counts);
        const claimResult = this.sanitizeString(entry.claim); counts = mergeRedactionCounts(counts, claimResult.counts);
        const snippetResult = this.sanitizeString(entry.snippet); counts = mergeRedactionCounts(counts, snippetResult.counts);
        const contentHash = entry.contentHash?.trim() || contentHashes.get(entry.file) || '';
        const verifiedAt = entry.verifiedAt ?? entry.createdAt;
        const isStale = entry.stale === true ? 1 : 0;
        insert.run(
          entry.claimId,
          entry.entityId,
          entry.entityType,
          fileResult.value,
          entry.line,
          entry.endLine ?? null,
          snippetResult.value,
          claimResult.value,
          entry.confidence,
          entry.createdAt,
          contentHash,
          verifiedAt,
          isStale
        );
      }
    });
    tx(entries);
    await this.recordRedactions(counts);
  }

  async getEvidenceForTarget(entityId: string, entityType: EvidenceEntry['entityType']): Promise<EvidenceRef[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT claim_id, entity_id, entity_type, file_path, line_start, line_end, snippet, claim, confidence, created_at, content_hash, verified_at, is_stale FROM librarian_evidence WHERE entity_id = ? AND entity_type = ? ORDER BY line_start').all(entityId, entityType) as StoredEvidenceRow[];
    if (!rows.length) return [];
    const verified = await this.verifyEvidenceRows(rows);
    return verified.map((row) => ({
      file: row.file_path,
      line: row.line_start,
      endLine: row.line_end ?? undefined,
      snippet: row.snippet,
      claim: row.claim,
      confidence: row.confidence,
      contentHash: row.content_hash ?? undefined,
      verifiedAt: row.verified_at ?? undefined,
      stale: Boolean(row.is_stale),
    }));
  }

  async deleteEvidence(entityId: string, entityType: 'function' | 'module'): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_evidence WHERE entity_id = ? AND entity_type = ?').run(entityId, entityType);
  }

  async getEvidenceVerificationSummary(options: EvidenceVerificationOptions = {}): Promise<EvidenceVerificationSummary> {
    const db = this.ensureDb();
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : undefined;
    const rows = limit
      ? db.prepare('SELECT claim_id, entity_id, entity_type, file_path, line_start, line_end, snippet, claim, confidence, created_at, content_hash, verified_at, is_stale FROM librarian_evidence ORDER BY created_at DESC LIMIT ?').all(limit) as StoredEvidenceRow[]
      : db.prepare('SELECT claim_id, entity_id, entity_type, file_path, line_start, line_end, snippet, claim, confidence, created_at, content_hash, verified_at, is_stale FROM librarian_evidence ORDER BY created_at DESC').all() as StoredEvidenceRow[];
    if (rows.length > 0) {
      await this.verifyEvidenceRows(rows, { force: options.force === true });
    }
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total_entries,
        SUM(CASE WHEN is_stale = 1 THEN 1 ELSE 0 END) AS stale_count,
        SUM(CASE WHEN verified_at IS NULL OR verified_at = '' THEN 1 ELSE 0 END) AS unverified_count,
        MIN(CASE WHEN verified_at IS NULL OR verified_at = '' THEN created_at END) AS oldest_unverified_at
      FROM librarian_evidence
    `).get() as {
      total_entries: number;
      stale_count: number | null;
      unverified_count: number | null;
      oldest_unverified_at: string | null;
    };
    return {
      totalEntries: summary.total_entries ?? 0,
      scannedEntries: rows.length,
      staleCount: summary.stale_count ?? 0,
      unverifiedCount: summary.unverified_count ?? 0,
      oldestUnverifiedAt: summary.oldest_unverified_at ?? undefined,
      verifiedAt: new Date().toISOString(),
    };
  }

  async exportEvidenceMarkdown(outputPath?: string): Promise<string> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT claim_id, entity_id, entity_type, file_path, line_start, line_end, snippet, claim, confidence, created_at, content_hash, verified_at, is_stale FROM librarian_evidence ORDER BY created_at DESC').all() as StoredEvidenceRow[];
    if (rows.length > 0) {
      await this.verifyEvidenceRows(rows);
    }
    const refreshed = db.prepare('SELECT claim_id, entity_id, entity_type, file_path, line_start, line_end, snippet, claim, confidence, created_at, content_hash, verified_at, is_stale FROM librarian_evidence ORDER BY created_at DESC').all() as StoredEvidenceRow[];
    const summary = await this.getEvidenceVerificationSummary({ limit: undefined });
    const lines: string[] = [];
    lines.push('# EVIDENCE');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total entries: ${summary.totalEntries}`);
    lines.push(`Stale entries: ${summary.staleCount}`);
    lines.push(`Unverified entries: ${summary.unverifiedCount}`);
    lines.push('');
    lines.push('| Entity | File | Line | Confidence | Status | Verified | Claim | Snippet |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of refreshed) {
      const status = row.is_stale ? 'STALE' : 'VALID';
      const lineLabel = row.line_end && row.line_end !== row.line_start
        ? `${row.line_start}-${row.line_end}`
        : String(row.line_start);
      const snippet = this.escapeEvidenceMarkdown(this.condenseEvidenceSnippet(row.snippet, 140));
      const claim = this.escapeEvidenceMarkdown(this.condenseEvidenceSnippet(row.claim, 120));
      lines.push(`| ${row.entity_type}:${row.entity_id} | ${this.escapeEvidenceMarkdown(row.file_path)} | ${lineLabel} | ${row.confidence} | ${status} | ${row.verified_at ?? ''} | ${claim} | ${snippet} |`);
    }
    const targetPath = outputPath
      ? path.resolve(outputPath)
      : path.join(this.workspaceRoot ?? path.dirname(this.dbPath), 'EVIDENCE.md');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, lines.join('\n') + '\n', 'utf8');
    return targetPath;
  }

  private async computeEvidenceContentHashes(entries: EvidenceEntry[]): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    const paths = new Set<string>();
    for (const entry of entries) {
      if (entry.contentHash && entry.contentHash.trim().length > 0) {
        hashes.set(entry.file, entry.contentHash.trim());
      } else {
        paths.add(entry.file);
      }
    }
    for (const filePath of paths) {
      const resolved = this.resolveEvidenceFilePath(filePath);
      try {
        const content = await fs.readFile(resolved, 'utf8');
        hashes.set(filePath, sha256Hex(content));
      } catch {
        hashes.set(filePath, '');
      }
    }
    return hashes;
  }

  private resolveEvidenceFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    if (this.workspaceRoot) return path.join(this.workspaceRoot, filePath);
    return path.resolve(path.dirname(this.dbPath), filePath);
  }

  private async readEvidenceFileState(
    cache: Map<string, EvidenceFileState>,
    filePath: string
  ): Promise<EvidenceFileState> {
    const cached = cache.get(filePath);
    if (cached) return cached;
    const resolved = this.resolveEvidenceFilePath(filePath);
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(resolved, 'utf8'),
        fs.stat(resolved),
      ]);
      const state: EvidenceFileState = {
        missing: false,
        content,
        lines: content.split(/\r?\n/),
        contentHash: sha256Hex(content),
        mtimeMs: stat.mtimeMs,
      };
      cache.set(filePath, state);
      return state;
    } catch {
      const missing: EvidenceFileState = { missing: true };
      cache.set(filePath, missing);
      return missing;
    }
  }

  private async verifyEvidenceRows(
    rows: StoredEvidenceRow[],
    options: { force?: boolean } = {}
  ): Promise<StoredEvidenceRow[]> {
    if (!rows.length) return rows;
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const fileCache = new Map<string, EvidenceFileState>();
    const update = db.prepare(`
      UPDATE librarian_evidence
      SET line_start = ?, line_end = ?, content_hash = ?, verified_at = ?, is_stale = ?
      WHERE claim_id = ?
    `);
    const tx = db.transaction((updates: Array<{
      claimId: string;
      lineStart: number;
      lineEnd: number | null;
      contentHash: string;
      verifiedAt: string;
      isStale: number;
    }>) => {
      for (const item of updates) {
        update.run(item.lineStart, item.lineEnd, item.contentHash, item.verifiedAt, item.isStale, item.claimId);
      }
    });
    const updates: Array<{
      claimId: string;
      lineStart: number;
      lineEnd: number | null;
      contentHash: string;
      verifiedAt: string;
      isStale: number;
    }> = [];
    const verifiedRows: StoredEvidenceRow[] = [];

    for (const row of rows) {
      const state = await this.readEvidenceFileState(fileCache, row.file_path);
      const previousVerifiedMs = row.verified_at ? Date.parse(row.verified_at) : Number.NaN;
      const needsVerification = options.force === true
        || !row.verified_at
        || !Number.isFinite(previousVerifiedMs)
        || state.missing
        || (!state.missing && (state.contentHash ?? '') !== (row.content_hash ?? ''))
        || !Number.isFinite(state.mtimeMs)
        || (state.mtimeMs as number) > previousVerifiedMs;

      if (!needsVerification) {
        verifiedRows.push(row);
        continue;
      }

      let lineStart = row.line_start;
      let lineEnd = row.line_end;
      let contentHash = state.contentHash ?? '';
      let isStale = 1;

      if (!state.missing && state.lines) {
        const snippetLines = row.snippet.split(/\r?\n/);
        const normalizedSnippet = this.normalizeEvidenceText(row.snippet);
        const claimedWindow = this.extractLineWindow(state.lines, row.line_start, row.line_end);
        if (this.normalizeEvidenceText(claimedWindow) === normalizedSnippet) {
          isStale = 0;
        } else {
          const exactMatch = this.findExactSnippetWindow(state.lines, snippetLines);
          if (exactMatch) {
            lineStart = exactMatch.startLine;
            lineEnd = exactMatch.endLine;
            isStale = 0;
          } else if (snippetLines.length >= EVIDENCE_MIN_FUZZY_LINES) {
            const fuzzyMatch = this.findFuzzySnippetWindow(state.lines, snippetLines);
            if (fuzzyMatch) {
              lineStart = fuzzyMatch.startLine;
              lineEnd = fuzzyMatch.endLine;
              isStale = 0;
            }
          }
        }
      } else {
        contentHash = '';
      }

      updates.push({
        claimId: row.claim_id,
        lineStart,
        lineEnd,
        contentHash,
        verifiedAt: now,
        isStale,
      });
      verifiedRows.push({
        ...row,
        line_start: lineStart,
        line_end: lineEnd,
        content_hash: contentHash,
        verified_at: now,
        is_stale: isStale,
      });
    }

    if (updates.length > 0) {
      tx(updates);
    }
    return verifiedRows;
  }

  private extractLineWindow(lines: string[], startLine: number, endLine: number | null): string {
    const start = Math.max(1, startLine);
    const end = Math.max(start, endLine ?? start);
    return lines.slice(start - 1, end).join('\n');
  }

  private findExactSnippetWindow(
    lines: string[],
    snippetLines: string[]
  ): { startLine: number; endLine: number } | null {
    if (snippetLines.length === 0) return null;
    const target = snippetLines.map((line) => this.normalizeEvidenceText(line));
    const windowSize = snippetLines.length;
    for (let start = 0; start <= lines.length - windowSize; start += 1) {
      let matches = true;
      for (let offset = 0; offset < windowSize; offset += 1) {
        if (this.normalizeEvidenceText(lines[start + offset]) !== target[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return {
          startLine: start + 1,
          endLine: start + windowSize,
        };
      }
    }
    return null;
  }

  private findFuzzySnippetWindow(
    lines: string[],
    snippetLines: string[]
  ): { startLine: number; endLine: number } | null {
    if (snippetLines.length === 0) return null;
    const snippetText = this.normalizeEvidenceText(snippetLines.join('\n'));
    if (!snippetText) return null;
    const snippetTokens = new Set((snippetText.match(/\w+/g) ?? []).map((token) => token.toLowerCase()));
    const minTokenOverlap = snippetTokens.size === 0
      ? 0
      : Math.max(1, Math.floor(snippetTokens.size * 0.6));
    const windowSize = snippetLines.length;
    const maxDistance = Math.max(1, Math.ceil(snippetText.length * EVIDENCE_FUZZY_MAX_DISTANCE_RATIO));

    let best:
      | {
        startLine: number;
        endLine: number;
        distance: number;
      }
      | null = null;

    for (let start = 0; start <= lines.length - windowSize; start += 1) {
      const windowText = this.normalizeEvidenceText(lines.slice(start, start + windowSize).join('\n'));
      if (!windowText) continue;

      if (snippetTokens.size > 0) {
        const windowTokens = new Set((windowText.match(/\w+/g) ?? []).map((token) => token.toLowerCase()));
        let overlap = 0;
        for (const token of snippetTokens) {
          if (windowTokens.has(token)) overlap += 1;
        }
        if (overlap < minTokenOverlap) continue;
      }

      const distance = this.levenshteinDistanceWithCutoff(snippetText, windowText, maxDistance);
      if (distance > maxDistance) continue;
      if (!best || distance < best.distance) {
        best = {
          startLine: start + 1,
          endLine: start + windowSize,
          distance,
        };
      }
    }
    return best ? { startLine: best.startLine, endLine: best.endLine } : null;
  }

  private levenshteinDistanceWithCutoff(a: string, b: string, cutoff: number): number {
    if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
    const prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
    const curr = new Array<number>(b.length + 1);
    for (let i = 1; i <= a.length; i += 1) {
      curr[0] = i;
      let rowMin = curr[0];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > cutoff) return cutoff + 1;
      for (let j = 0; j <= b.length; j += 1) {
        prev[j] = curr[j];
      }
    }
    return prev[b.length];
  }

  private normalizeEvidenceText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
  }

  private condenseEvidenceSnippet(text: string, maxLength: number): string {
    const flattened = text.replace(/\s+/g, ' ').trim();
    if (flattened.length <= maxLength) return flattened;
    return `${flattened.slice(0, maxLength - 1)}…`;
  }

  private escapeEvidenceMarkdown(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
  }

  // --------------------------------------------------------------------------
  // Indexing History
  // --------------------------------------------------------------------------

  async recordIndexingResult(result: IndexingResult): Promise<void> {
    const db = this.ensureDb();

    db.prepare(`
      INSERT INTO librarian_indexing_history (
        id, task_type, started_at, completed_at, files_processed, files_skipped,
        functions_indexed, modules_indexed, context_packs_created,
        errors, version_string
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.taskId,
      result.type,
      result.startedAt.toISOString(),
      result.completedAt.toISOString(),
      result.filesProcessed,
      result.filesSkipped,
      result.functionsIndexed,
      result.modulesIndexed,
      result.contextPacksCreated,
      JSON.stringify(result.errors),
      result.version.string
    );
  }

  async getLastIndexingResult(): Promise<IndexingResult | null> {
    const db = this.ensureDb();
    const row = db
      .prepare(
        'SELECT * FROM librarian_indexing_history ORDER BY completed_at DESC LIMIT 1'
      )
      .get() as IndexingHistoryRow | undefined;

    if (!row) return noResult();
    return rowToIndexingResult(row);
  }

  // --------------------------------------------------------------------------
  // Bootstrap History
  // --------------------------------------------------------------------------

  async recordBootstrapReport(report: BootstrapReport): Promise<void> {
    const db = this.ensureDb();

    db.prepare(`
      INSERT INTO librarian_bootstrap_history (
        id, workspace, started_at, completed_at, phases, total_files,
        total_functions, total_context_packs, version_string, success, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      report.workspace,
      report.startedAt.toISOString(),
      report.completedAt?.toISOString() || null,
      JSON.stringify(report.phases),
      report.totalFilesProcessed,
      report.totalFunctionsIndexed,
      report.totalContextPacksCreated,
      report.version.string,
      report.success ? 1 : 0,
      report.error || null
    );
  }

  async getLastBootstrapReport(): Promise<BootstrapReport | null> {
    const db = this.ensureDb();
    const row = db
      .prepare(
        'SELECT * FROM librarian_bootstrap_history ORDER BY started_at DESC LIMIT 1'
      )
      .get() as BootstrapHistoryRow | undefined;

    if (!row) return noResult();
    return rowToBootstrapReport(row);
  }

  // --------------------------------------------------------------------------
  // Evolution Outcomes
  // --------------------------------------------------------------------------

  async recordEvolutionOutcome(outcome: EvolutionOutcome): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_evolution_outcomes (
        task_id, task_type, agent_id, success, duration_ms, quality_score,
        files_changed, tests_added, tests_pass, librarian_context_used,
        context_pack_count, decomposed, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        task_type = excluded.task_type,
        agent_id = excluded.agent_id,
        success = excluded.success,
        duration_ms = excluded.duration_ms,
        quality_score = excluded.quality_score,
        files_changed = excluded.files_changed,
        tests_added = excluded.tests_added,
        tests_pass = excluded.tests_pass,
        librarian_context_used = excluded.librarian_context_used,
        context_pack_count = excluded.context_pack_count,
        decomposed = excluded.decomposed,
        timestamp = excluded.timestamp
    `).run(
      outcome.taskId,
      outcome.taskType,
      outcome.agentId,
      outcome.success ? 1 : 0,
      outcome.durationMs,
      outcome.qualityScore,
      JSON.stringify(outcome.filesChanged),
      outcome.testsAdded,
      outcome.testsPass ? 1 : 0,
      outcome.context.librarianContextUsed ? 1 : 0,
      outcome.context.contextPackCount,
      outcome.context.decomposed ? 1 : 0,
      outcome.timestamp.toISOString()
    );
  }

  async getEvolutionOutcomes(options: EvolutionOutcomeQueryOptions = {}): Promise<EvolutionOutcome[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.agentId) {
      clauses.push('agent_id = ?');
      params.push(options.agentId);
    }
    if (options.taskType) {
      clauses.push('task_type = ?');
      params.push(options.taskType);
    }
    if (options.success !== undefined) {
      clauses.push('success = ?');
      params.push(options.success ? 1 : 0);
    }
    if (options.timeRange) {
      clauses.push('timestamp >= ? AND timestamp <= ?');
      params.push(options.timeRange.start.toISOString(), options.timeRange.end.toISOString());
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const orderBy = validateOrderColumn(options.orderBy || 'timestamp');
    const orderDir = validateOrderDirection(options.orderDirection || 'desc');
    let limitClause = '';
    if (options.limit) {
      limitClause = ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(
      `SELECT * FROM librarian_evolution_outcomes${where} ORDER BY ${orderBy} ${orderDir.toUpperCase()}${limitClause}`
    ).all(...params) as Array<{
      task_id: string;
      task_type: string;
      agent_id: string;
      success: number;
      duration_ms: number;
      quality_score: number;
      files_changed: string;
      tests_added: number;
      tests_pass: number;
      librarian_context_used: number;
      context_pack_count: number;
      decomposed: number;
      timestamp: string;
    }>;

    return rows.map(row => ({
      taskId: row.task_id,
      taskType: row.task_type,
      agentId: row.agent_id,
      success: row.success === 1,
      durationMs: row.duration_ms,
      qualityScore: row.quality_score,
      filesChanged: safeJsonParseOrNull<string[]>(row.files_changed) || [],
      testsAdded: row.tests_added,
      testsPass: row.tests_pass === 1,
      context: {
        librarianContextUsed: row.librarian_context_used === 1,
        contextPackCount: row.context_pack_count,
        decomposed: row.decomposed === 1,
      },
      timestamp: new Date(row.timestamp),
    }));
  }

  // --------------------------------------------------------------------------
  // Learned Missing Context
  // --------------------------------------------------------------------------

  async recordLearnedMissing(context: string, taskId: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_learned_missing (context, task_id, recorded_at)
      VALUES (?, ?, ?)
      ON CONFLICT(context, task_id) DO UPDATE SET recorded_at = excluded.recorded_at
    `).run(context, taskId, new Date().toISOString());
  }

  async getLearnedMissing(): Promise<LearnedMissingContext[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT context, task_id, recorded_at FROM librarian_learned_missing ORDER BY recorded_at DESC').all() as Array<{
      context: string;
      task_id: string;
      recorded_at: string;
    }>;
    return rows.map(row => ({
      context: row.context,
      taskId: row.task_id,
      recordedAt: new Date(row.recorded_at),
    }));
  }

  async clearLearnedMissing(context: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_learned_missing WHERE context = ?').run(context);
  }

  // --------------------------------------------------------------------------
  // Quality Score History
  // --------------------------------------------------------------------------

  async recordQualityScore(score: Omit<QualityScoreHistory, 'id' | 'recordedAt'>): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_quality_history (id, overall, maintainability, testability, readability, complexity, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      score.overall,
      score.maintainability,
      score.testability,
      score.readability,
      score.complexity,
      new Date().toISOString()
    );
  }

  async getQualityScoreHistory(limit: number = 30): Promise<QualityScoreHistory[]> {
    const db = this.ensureDb();
    const rows = db.prepare(
      'SELECT id, overall, maintainability, testability, readability, complexity, recorded_at FROM librarian_quality_history ORDER BY recorded_at DESC LIMIT ?'
    ).all(limit) as Array<{
      id: string;
      overall: number;
      maintainability: number;
      testability: number;
      readability: number;
      complexity: number;
      recorded_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      overall: row.overall,
      maintainability: row.maintainability,
      testability: row.testability,
      readability: row.readability,
      complexity: row.complexity,
      recordedAt: new Date(row.recorded_at),
    }));
  }

  // --------------------------------------------------------------------------
  // Confidence Updates
  // --------------------------------------------------------------------------

  async updateConfidence(
    entityId: string,
    entityType: 'function' | 'module' | 'context_pack',
    delta: number,
    reason: string
  ): Promise<void> {
    const db = this.ensureDb();
    const table =
      entityType === 'function'
        ? 'librarian_functions'
        : entityType === 'module'
          ? 'librarian_modules'
          : 'librarian_context_packs';
    const idCol = entityType === 'context_pack' ? 'pack_id' : 'id';
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE ${table}
      SET confidence = MAX(0.1, MIN(0.95, confidence + ?)),
          last_verified_at = ?
      WHERE ${idCol} = ?
    `).run(delta, now, entityId);
    db.prepare(`
      INSERT INTO librarian_confidence_events (id, entity_id, entity_type, delta, updated_at, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), entityId, entityType, delta, now, reason);
  }

  async applyTimeDecay(decayRate: number): Promise<number> {
    const db = this.ensureDb();

    const result1 = db
      .prepare(`
        UPDATE librarian_functions
        SET confidence = MAX(0.1, confidence - ?)
        WHERE confidence > 0.1
      `)
      .run(decayRate);

    const result2 = db
      .prepare(`
        UPDATE librarian_modules
        SET confidence = MAX(0.1, confidence - ?)
        WHERE confidence > 0.1
      `)
      .run(decayRate);

    const result3 = db
      .prepare(`
        UPDATE librarian_context_packs
        SET confidence = MAX(0.1, confidence - ?)
        WHERE confidence > 0.1 AND invalidated = 0
      `)
      .run(decayRate);

    return result1.changes + result2.changes + result3.changes;
  }

  async countConfidenceUpdates(
    entityId: string,
    entityType: 'function' | 'module' | 'context_pack',
    sinceIso: string,
    deltaFilter: 'any' | 'negative' | 'positive' = 'any'
  ): Promise<number> {
    const db = this.ensureDb();
    let sql = 'SELECT COUNT(*) as count FROM librarian_confidence_events WHERE entity_id = ? AND entity_type = ? AND updated_at >= ?';
    const params: unknown[] = [entityId, entityType, sinceIso];
    if (deltaFilter === 'negative') sql += ' AND delta < 0';
    if (deltaFilter === 'positive') sql += ' AND delta > 0';
    const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  async storeCochangeEdges(edges: CochangeEdge[], computedAt: string = new Date().toISOString()): Promise<void> {
    const db = this.ensureDb();
    if (!edges.length) return;
    const insert = db.prepare(`
      INSERT INTO librarian_cochange (file_a, file_b, change_count, total_changes, strength, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_a, file_b) DO UPDATE SET
        change_count = excluded.change_count,
        total_changes = excluded.total_changes,
        strength = excluded.strength,
        computed_at = excluded.computed_at
    `);
    const tx = db.transaction((rows: CochangeEdge[]) => {
      for (const edge of rows) {
        insert.run(edge.fileA, edge.fileB, edge.changeCount, edge.totalChanges, edge.strength, computedAt);
      }
    });
    tx(edges);
  }

  async getCochangeEdgeCount(): Promise<number> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM librarian_cochange').get() as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  async getCochangeEdges(options: CochangeQueryOptions = {}): Promise<CochangeEdge[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.fileA) {
      clauses.push('(file_a = ? OR file_b = ?)');
      params.push(options.fileA, options.fileA);
    }
    if (options.fileB) {
      clauses.push('(file_a = ? OR file_b = ?)');
      params.push(options.fileB, options.fileB);
    }
    if (options.minStrength !== undefined) {
      clauses.push('strength >= ?');
      params.push(options.minStrength);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const orderBy = validateOrderColumn(options.orderBy === 'change_count' ? 'change_count' : 'strength');
    const orderDir = validateOrderDirection(options.orderDirection || 'desc');
    let limitClause = '';
    if (options.limit) {
      limitClause = ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = db.prepare(`SELECT * FROM librarian_cochange${where} ORDER BY ${orderBy} ${orderDir}${limitClause}`).all(...params) as {
      file_a: string;
      file_b: string;
      change_count: number;
      total_changes: number;
      strength: number;
    }[];

    return rows.map((row) => ({
      fileA: row.file_a,
      fileB: row.file_b,
      changeCount: row.change_count,
      totalChanges: row.total_changes,
      strength: row.strength,
    }));
  }

  async deleteCochangeEdges(): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_cochange').run();
  }

  // --------------------------------------------------------------------------
  // Confidence Events
  // --------------------------------------------------------------------------

  async getConfidenceEvents(options: ConfidenceEventQueryOptions = {}): Promise<ConfidenceEvent[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.entityId) {
      clauses.push('entity_id = ?');
      params.push(options.entityId);
    }
    if (options.entityType) {
      clauses.push('entity_type = ?');
      params.push(options.entityType);
    }
    if (options.sinceIso) {
      clauses.push('updated_at >= ?');
      params.push(options.sinceIso);
    }
    if (options.deltaFilter === 'negative') {
      clauses.push('delta < 0');
    } else if (options.deltaFilter === 'positive') {
      clauses.push('delta > 0');
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const orderDir = options.orderDirection === 'asc' ? 'ASC' : 'DESC';
    const limit = options.limit ? ` LIMIT ${options.limit}` : '';
    const rows = db.prepare(`SELECT * FROM librarian_confidence_events${where} ORDER BY updated_at ${orderDir}${limit}`).all(...params) as {
      id: string;
      entity_id: string;
      entity_type: 'function' | 'module' | 'context_pack';
      delta: number;
      updated_at: string;
      reason: string | null;
    }[];

    return rows.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      entityType: row.entity_type,
      delta: row.delta,
      updatedAt: new Date(row.updated_at),
      reason: row.reason,
    }));
  }

  // --------------------------------------------------------------------------
  // Test Mappings
  // --------------------------------------------------------------------------

  async getTestMapping(id: string): Promise<TestMapping | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM librarian_test_mapping WHERE id = ?').get(id) as TestMappingRow | undefined;
    return row ? rowToTestMapping(row) : null;
  }

  async getTestMappings(options: TestMappingQueryOptions = {}): Promise<TestMapping[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.testPath) {
      clauses.push('test_path = ?');
      params.push(options.testPath);
    }
    if (options.sourcePath) {
      clauses.push('source_path = ?');
      params.push(options.sourcePath);
    }
    if (options.minConfidence !== undefined) {
      clauses.push('confidence >= ?');
      params.push(options.minConfidence);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit ? ` LIMIT ${options.limit}` : '';
    const rows = db.prepare(`SELECT * FROM librarian_test_mapping${where} ORDER BY confidence DESC${limit}`).all(...params) as TestMappingRow[];
    return rows.map(rowToTestMapping);
  }

  async getTestMappingsByTestPath(testPath: string): Promise<TestMapping[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librarian_test_mapping WHERE test_path = ? ORDER BY confidence DESC').all(testPath) as TestMappingRow[];
    return rows.map(rowToTestMapping);
  }

  async getTestMappingsBySourcePath(sourcePath: string): Promise<TestMapping[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librarian_test_mapping WHERE source_path = ? ORDER BY confidence DESC').all(sourcePath) as TestMappingRow[];
    return rows.map(rowToTestMapping);
  }

  async upsertTestMapping(mapping: Omit<TestMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<TestMapping> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const id = randomUUID();

    db.prepare(`
      INSERT INTO librarian_test_mapping (id, test_path, source_path, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(test_path, source_path) DO UPDATE SET
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(id, mapping.testPath, mapping.sourcePath, mapping.confidence, now, now);

    // Fetch the actual inserted/updated row
    const row = db.prepare('SELECT * FROM librarian_test_mapping WHERE test_path = ? AND source_path = ?').get(mapping.testPath, mapping.sourcePath) as TestMappingRow;
    return rowToTestMapping(row);
  }

  async deleteTestMapping(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_test_mapping WHERE id = ?').run(id);
  }

  async deleteTestMappingsByTestPath(testPath: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_test_mapping WHERE test_path = ?').run(testPath);
    return result.changes;
  }

  // --------------------------------------------------------------------------
  // Commits
  // --------------------------------------------------------------------------

  async getCommit(id: string): Promise<LiBrainianCommit | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM librarian_commits WHERE id = ?').get(id) as CommitRow | undefined;
    return row ? rowToCommit(row) : null;
  }

  async getCommitBySha(sha: string): Promise<LiBrainianCommit | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM librarian_commits WHERE sha = ?').get(sha) as CommitRow | undefined;
    return row ? rowToCommit(row) : null;
  }

  async getCommits(options: CommitQueryOptions = {}): Promise<LiBrainianCommit[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.sha) {
      clauses.push('sha = ?');
      params.push(options.sha);
    }
    if (options.author) {
      clauses.push('author = ?');
      params.push(options.author);
    }
    if (options.category) {
      clauses.push('category = ?');
      params.push(options.category);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const orderDir = options.orderDirection === 'asc' ? 'ASC' : 'DESC';
    const limit = options.limit ? ` LIMIT ${options.limit}` : '';
    const rows = db.prepare(`SELECT * FROM librarian_commits${where} ORDER BY created_at ${orderDir}${limit}`).all(...params) as CommitRow[];
    return rows.map(rowToCommit);
  }

  async upsertCommit(commit: Omit<LiBrainianCommit, 'id' | 'createdAt'>): Promise<LiBrainianCommit> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const id = randomUUID();

    db.prepare(`
      INSERT INTO librarian_commits (id, sha, message, author, category, files_changed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sha) DO UPDATE SET
        message = excluded.message,
        author = excluded.author,
        category = excluded.category,
        files_changed = excluded.files_changed
    `).run(id, commit.sha, commit.message, commit.author, commit.category, JSON.stringify(commit.filesChanged), now);

    // Fetch the actual inserted/updated row
    const row = db.prepare('SELECT * FROM librarian_commits WHERE sha = ?').get(commit.sha) as CommitRow;
    return rowToCommit(row);
  }

  async deleteCommit(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_commits WHERE id = ?').run(id);
  }

  async deleteCommitBySha(sha: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_commits WHERE sha = ?').run(sha);
  }

  // --------------------------------------------------------------------------
  // Ownership
  // --------------------------------------------------------------------------

  async getOwnership(id: string): Promise<FileOwnership | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM librarian_ownership WHERE id = ?').get(id) as OwnershipRow | undefined;
    return row ? rowToOwnership(row) : null;
  }

  async getOwnershipByFilePath(filePath: string): Promise<FileOwnership[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librarian_ownership WHERE file_path = ? ORDER BY score DESC').all(filePath) as OwnershipRow[];
    return rows.map(rowToOwnership);
  }

  async getOwnershipByAuthor(author: string): Promise<FileOwnership[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librarian_ownership WHERE author = ? ORDER BY score DESC').all(author) as OwnershipRow[];
    return rows.map(rowToOwnership);
  }

  async getOwnerships(options: OwnershipQueryOptions = {}): Promise<FileOwnership[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.filePath) {
      clauses.push('file_path = ?');
      params.push(options.filePath);
    }
    if (options.author) {
      clauses.push('author = ?');
      params.push(options.author);
    }
    if (options.minScore !== undefined) {
      clauses.push('score >= ?');
      params.push(options.minScore);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const orderBy = validateOrderColumn(options.orderBy === 'last_modified' ? 'last_modified' : 'score');
    const orderDir = validateOrderDirection(options.orderDirection || 'desc');
    let limitClause = '';
    if (options.limit) {
      limitClause = ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = db.prepare(`SELECT * FROM librarian_ownership${where} ORDER BY ${orderBy} ${orderDir}${limitClause}`).all(...params) as OwnershipRow[];
    return rows.map(rowToOwnership);
  }

  async upsertOwnership(ownership: Omit<FileOwnership, 'id' | 'createdAt'>): Promise<FileOwnership> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const id = randomUUID();

    db.prepare(`
      INSERT INTO librarian_ownership (id, file_path, author, score, last_modified, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path, author) DO UPDATE SET
        score = excluded.score,
        last_modified = excluded.last_modified
    `).run(id, ownership.filePath, ownership.author, ownership.score, ownership.lastModified.toISOString(), now);

    // Fetch the actual inserted/updated row
    const row = db.prepare('SELECT * FROM librarian_ownership WHERE file_path = ? AND author = ?').get(ownership.filePath, ownership.author) as OwnershipRow;
    return rowToOwnership(row);
  }

  async deleteOwnership(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_ownership WHERE id = ?').run(id);
  }

  async deleteOwnershipByFilePath(filePath: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_ownership WHERE file_path = ?').run(filePath);
    return result.changes;
  }

  // --------------------------------------------------------------------------
  // Universal Knowledge
  // --------------------------------------------------------------------------

  async getUniversalKnowledge(id: string): Promise<UniversalKnowledgeRecord | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM librarian_universal_knowledge WHERE id = ?').get(id) as UniversalKnowledgeRow | undefined;
    return row ? rowToUniversalKnowledge(row) : null;
  }

  async getUniversalKnowledgeByFile(filePath: string): Promise<UniversalKnowledgeRecord[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librarian_universal_knowledge WHERE file = ? ORDER BY line ASC').all(filePath) as UniversalKnowledgeRow[];
    return rows.map(rowToUniversalKnowledge);
  }

  async getUniversalKnowledgeByKind(kind: string): Promise<UniversalKnowledgeRecord[]> {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librarian_universal_knowledge WHERE kind = ? ORDER BY name ASC').all(kind) as UniversalKnowledgeRow[];
    return rows.map(rowToUniversalKnowledge);
  }

  async queryUniversalKnowledge(options: UniversalKnowledgeQueryOptions): Promise<UniversalKnowledgeRecord[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.kind) {
      clauses.push('kind = ?');
      params.push(options.kind);
    }
    if (options.file) {
      clauses.push('file = ?');
      params.push(options.file);
    }
    if (options.filePrefix) {
      const prefix = options.filePrefix.replaceAll('\\', '/');
      clauses.push('file LIKE ?');
      params.push(`${prefix}%`);
    }
    if (options.minConfidence !== undefined) {
      clauses.push('confidence >= ?');
      params.push(options.minConfidence);
    }
    if (options.minMaintainability !== undefined) {
      clauses.push('maintainability_index >= ?');
      params.push(options.minMaintainability);
    }
    if (options.maxRisk !== undefined) {
      clauses.push('risk_score <= ?');
      params.push(options.maxRisk);
    }
    if (options.minCoverage !== undefined) {
      clauses.push('test_coverage >= ?');
      params.push(options.minCoverage);
    }
    if (options.maxComplexity !== undefined) {
      clauses.push('cyclomatic_complexity <= ?');
      params.push(options.maxComplexity);
    }
    if (options.searchText) {
      clauses.push('purpose_summary LIKE ?');
      params.push(`%${options.searchText}%`);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

    const orderByMap: Record<string, string> = {
      confidence: 'confidence',
      maintainability: 'maintainability_index',
      risk: 'risk_score',
      coverage: 'test_coverage',
      complexity: 'cyclomatic_complexity',
      name: 'name',
    };
    const orderBy = validateOrderColumn(orderByMap[options.orderBy ?? 'name'] ?? 'name');
    const orderDir = validateOrderDirection(options.orderDirection || 'desc');
    let limitClause = '';
    if (options.limit) {
      limitClause = ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      limitClause += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = db.prepare(`SELECT * FROM librarian_universal_knowledge${where} ORDER BY ${orderBy} ${orderDir}${limitClause}`).all(...params) as UniversalKnowledgeRow[];
    return rows.map(rowToUniversalKnowledge);
  }

  async upsertUniversalKnowledge(knowledge: UniversalKnowledgeRecord): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT INTO librarian_universal_knowledge (
        id, kind, name, qualified_name, file, line, knowledge,
        purpose_summary, maintainability_index, risk_score, test_coverage,
        cyclomatic_complexity, cognitive_complexity, embedding,
        confidence, generated_at, valid_until, hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        qualified_name = excluded.qualified_name,
        file = excluded.file,
        line = excluded.line,
        knowledge = excluded.knowledge,
        purpose_summary = excluded.purpose_summary,
        maintainability_index = excluded.maintainability_index,
        risk_score = excluded.risk_score,
        test_coverage = excluded.test_coverage,
        cyclomatic_complexity = excluded.cyclomatic_complexity,
        cognitive_complexity = excluded.cognitive_complexity,
        embedding = excluded.embedding,
        confidence = excluded.confidence,
        generated_at = excluded.generated_at,
        valid_until = excluded.valid_until,
        hash = excluded.hash
    `).run(
      knowledge.id,
      knowledge.kind,
      knowledge.name,
      knowledge.qualifiedName,
      knowledge.file,
      knowledge.line,
      knowledge.knowledge,
      knowledge.purposeSummary ?? null,
      knowledge.maintainabilityIndex ?? null,
      knowledge.riskScore ?? null,
      knowledge.testCoverage ?? null,
      knowledge.cyclomaticComplexity ?? null,
      knowledge.cognitiveComplexity ?? null,
      knowledge.embedding ? Buffer.from(knowledge.embedding.buffer) : null,
      knowledge.confidence,
      knowledge.generatedAt,
      knowledge.validUntil ?? null,
      knowledge.hash
    );
  }

  async upsertUniversalKnowledgeBatch(records: UniversalKnowledgeRecord[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO librarian_universal_knowledge (
        id, kind, name, qualified_name, file, line, knowledge,
        purpose_summary, maintainability_index, risk_score, test_coverage,
        cyclomatic_complexity, cognitive_complexity, embedding,
        confidence, generated_at, valid_until, hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        qualified_name = excluded.qualified_name,
        file = excluded.file,
        line = excluded.line,
        knowledge = excluded.knowledge,
        purpose_summary = excluded.purpose_summary,
        maintainability_index = excluded.maintainability_index,
        risk_score = excluded.risk_score,
        test_coverage = excluded.test_coverage,
        cyclomatic_complexity = excluded.cyclomatic_complexity,
        cognitive_complexity = excluded.cognitive_complexity,
        embedding = excluded.embedding,
        confidence = excluded.confidence,
        generated_at = excluded.generated_at,
        valid_until = excluded.valid_until,
        hash = excluded.hash
    `);

    const insertMany = db.transaction((items: UniversalKnowledgeRecord[]) => {
      for (const k of items) {
        stmt.run(
          k.id, k.kind, k.name, k.qualifiedName, k.file, k.line, k.knowledge,
          k.purposeSummary ?? null, k.maintainabilityIndex ?? null,
          k.riskScore ?? null, k.testCoverage ?? null,
          k.cyclomaticComplexity ?? null, k.cognitiveComplexity ?? null,
          k.embedding ? Buffer.from(k.embedding.buffer) : null,
          k.confidence, k.generatedAt, k.validUntil ?? null, k.hash
        );
      }
    });

    insertMany(records);
  }

  async deleteUniversalKnowledge(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_universal_knowledge WHERE id = ?').run(id);
  }

  async deleteUniversalKnowledgeByFile(filePath: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_universal_knowledge WHERE file = ?').run(filePath);
    return result.changes;
  }

  async searchUniversalKnowledgeBySimilarity(
    embedding: Float32Array,
    options: UniversalKnowledgeSimilarityOptions
  ): Promise<UniversalKnowledgeSimilarityResult[]> {
    const db = this.ensureDb();
    const expectedBytes = embedding.length * Float32Array.BYTES_PER_ELEMENT;

    // Build query with filters
    const clauses: string[] = ['embedding IS NOT NULL'];
    const params: unknown[] = [];

    if (options.kinds && options.kinds.length > 0) {
      clauses.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`);
      params.push(...options.kinds);
    }
    if (options.files && options.files.length > 0) {
      clauses.push(`file IN (${options.files.map(() => '?').join(', ')})`);
      params.push(...options.files);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const countRow = db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN length(embedding) = ? THEN 1 ELSE 0 END) as matching ` +
      `FROM librarian_universal_knowledge${where}`
    ).get(expectedBytes, ...params) as { total: number; matching: number | null } | undefined;
    const totalEmbeddings = countRow?.total ?? 0;
    const matchingEmbeddings = Number(countRow?.matching ?? 0);
    if (totalEmbeddings > 0 && matchingEmbeddings === 0) {
      throw new Error(
        `unverified_by_trace(embedding_dimension_mismatch): stored embeddings do not match ` +
        `query dimension ${embedding.length}. Re-index embeddings to ${embedding.length} dimensions.`
      );
    }
    if (totalEmbeddings > matchingEmbeddings) {
      logWarning('[librarian] Skipping universal knowledge embeddings with dimension mismatch', {
        expectedDimension: embedding.length,
        totalEmbeddings,
        matchingEmbeddings,
      });
    }

    const whereWithDimension = `${where}${where ? ' AND ' : ' WHERE '}length(embedding) = ?`;
    const rows = db.prepare(`SELECT id, name, file, kind, purpose_summary, embedding FROM librarian_universal_knowledge${whereWithDimension}`)
      .all(...params, expectedBytes) as Array<{
      id: string;
      name: string;
      file: string;
      kind: string;
      purpose_summary: string | null;
      embedding: Buffer | null;
    }>;

    // Compute similarities
    const results: UniversalKnowledgeSimilarityResult[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const storedEmbedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
      const similarity = cosineSimilarity(embedding, storedEmbedding);
      if (similarity >= options.minSimilarity) {
        results.push({
          id: row.id,
          name: row.name,
          file: row.file,
          kind: row.kind,
          similarity,
          purposeSummary: row.purpose_summary ?? undefined,
        });
      }
    }

    // Sort by similarity descending and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  // --------------------------------------------------------------------------
  // Bulk Operations
  // --------------------------------------------------------------------------

  async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const db = this.ensureDb();
    const pendingChanges = new Map<string, { type: IndexChangeEventType; path: string; timestamp: string }>();
    const trackChange = (type: IndexChangeEventType, rawPath?: string): void => {
      const normalizedPath = this.normalizeChangePath(rawPath);
      if (!normalizedPath) return;
      const key = `${type}:${normalizedPath}`;
      if (pendingChanges.has(key)) return;
      pendingChanges.set(key, {
        type,
        path: normalizedPath,
        timestamp: new Date().toISOString(),
      });
    };
    const txContext = this.createTransactionContext(trackChange);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionChain;
    this.transactionChain = previous.then(() => gate).catch(() => gate);

    await previous;
    const baseVersion = this.readIndexCoordinationVersion(db);
    try {
      db.exec('BEGIN');
    } catch (error) {
      release();
      throw error;
    }
    try {
      const result = await fn(txContext);
      let nextVersion = baseVersion;
      if (pendingChanges.size > 0) {
        nextVersion = this.bumpIndexCoordinationVersion(db, baseVersion);
        this.persistIndexChangeLog(db, Array.from(pendingChanges.values()), nextVersion);
      }
      db.exec('COMMIT');
      release();
      if (pendingChanges.size > 0) {
        for (const change of pendingChanges.values()) {
          void globalEventBus.emit(createIndexChangeEvent(change.type, change.path, nextVersion, change.timestamp));
        }
      }
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        logWarning('SQLite rollback failed', { path: this.dbPath, error: rollbackError });
      }
      release();
      throw error;
    }
  }

  private createTransactionContext(
    trackChange: (type: IndexChangeEventType, path?: string) => void
  ): TransactionContext {
    return {
      upsertFunction: async (fn) => {
        await this.upsertFunction(fn);
        trackChange('function_updated', fn.filePath);
      },
      upsertModule: async (mod) => {
        await this.upsertModule(mod);
        trackChange('function_updated', mod.path);
      },
      upsertContextPack: async (pack) => {
        await this.upsertContextPack(pack);
        trackChange('function_updated', pack.relatedFiles[0] ?? pack.targetId);
      },
      upsertIngestionItem: this.upsertIngestionItem.bind(this),
      upsertTestMapping: async (mapping) => {
        const result = await this.upsertTestMapping(mapping);
        trackChange('function_updated', (mapping as { sourcePath?: string }).sourcePath);
        return result;
      },
      upsertCommit: this.upsertCommit.bind(this),
      upsertOwnership: async (ownership) => {
        const result = await this.upsertOwnership(ownership);
        trackChange('function_updated', ownership.filePath);
        return result;
      },
      upsertFile: async (file) => {
        await this.upsertFile(file);
        trackChange('function_updated', file.path);
      },
      upsertFiles: async (files) => {
        await this.upsertFiles(files);
        for (const file of files) {
          trackChange('function_updated', file.path);
        }
      },
      upsertDirectory: this.upsertDirectory.bind(this),
      upsertDirectories: this.upsertDirectories.bind(this),
      upsertAssessment: this.upsertAssessment.bind(this),
      upsertAssessments: this.upsertAssessments.bind(this),
      setEmbedding: this.setEmbedding.bind(this),
      upsertMultiVector: async (record) => {
        await this.upsertMultiVector(record);
        trackChange('function_updated', record.payload.filePath);
      },
      deleteFunction: this.deleteFunction.bind(this),
      deleteFunctionsByPath: async (filePath) => {
        await this.deleteFunctionsByPath(filePath);
        trackChange('file_removed', filePath);
      },
      deleteModule: this.deleteModule.bind(this),
      deleteFileByPath: async (filePath) => {
        await this.deleteFileByPath(filePath);
        trackChange('file_removed', filePath);
      },
      deleteUniversalKnowledgeByFile: async (filePath) => {
        const deleted = await this.deleteUniversalKnowledgeByFile(filePath);
        trackChange('file_removed', filePath);
        return deleted;
      },
      deleteContextPack: this.deleteContextPack.bind(this),
      invalidateContextPacks: async (triggerPath) => {
        const count = await this.invalidateContextPacks(triggerPath);
        trackChange('function_updated', triggerPath);
        return count;
      },
      upsertGraphEdges: async (edges) => {
        await this.upsertGraphEdges(edges);
        for (const edge of edges) {
          trackChange('function_updated', edge.sourceFile);
        }
      },
      deleteGraphEdgesForSource: async (sourceFile) => {
        await this.deleteGraphEdgesForSource(sourceFile);
        trackChange('function_updated', sourceFile);
      },
      setFileChecksum: async (filePath, checksum, updatedAt) => {
        const existingChecksum = await this.getFileChecksum(filePath);
        await this.setFileChecksum(filePath, checksum, updatedAt);
        trackChange(existingChecksum ? 'function_updated' : 'file_added', filePath);
      },
    };
  }

  private normalizeChangePath(pathValue?: string): string | null {
    if (!pathValue) return null;
    const trimmed = pathValue.trim();
    if (!trimmed) return null;
    return trimmed.replaceAll('\\', '/');
  }

  private readIndexCoordinationVersion(db: Database.Database): number {
    const row = db
      .prepare('SELECT version FROM librarian_index_coordination WHERE singleton = ?')
      .get(this.indexCoordinationRowId) as { version?: number } | undefined;
    if (!row || !Number.isFinite(row.version)) return 0;
    return Number(row.version);
  }

  private bumpIndexCoordinationVersion(db: Database.Database, expectedVersion: number): number {
    const result = db.prepare(`
      UPDATE librarian_index_coordination
      SET version = version + 1
      WHERE singleton = ? AND version = ?
    `).run(this.indexCoordinationRowId, expectedVersion);
    if (result.changes !== 1) {
      throw new TransactionConflictError(
        `optimistic index coordination conflict: expected version ${expectedVersion}`
      );
    }
    return expectedVersion + 1;
  }

  private persistIndexChangeLog(
    db: Database.Database,
    changes: Array<{ type: IndexChangeEventType; path: string; timestamp: string }>,
    version: number
  ): void {
    const insert = db.prepare(`
      INSERT INTO librarian_change_log (id, event_type, path, version, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const change of changes) {
      insert.run(randomUUID(), change.type, change.path, version, change.timestamp);
    }
  }

  async getIndexCoordinationVersion(): Promise<number> {
    const db = this.ensureDb();
    return this.readIndexCoordinationVersion(db);
  }

  async getIndexChangeEvents(options: IndexChangeQueryOptions = {}): Promise<IndexChangeEvent[]> {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (Number.isFinite(options.sinceVersion)) {
      clauses.push('version > ?');
      params.push(Math.floor(options.sinceVersion ?? 0));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 200;
    const rows = db.prepare(`
      SELECT id, event_type, path, version, created_at
      FROM librarian_change_log
      ${where}
      ORDER BY version ASC, created_at ASC
      LIMIT ?
    `).all(...params, limit) as Array<{
      id: string;
      event_type: string;
      path: string;
      version: number;
      created_at: string;
    }>;
    const filtered = rows
      .map((row) => ({
        id: row.id,
        type: row.event_type as IndexChangeEventType,
        path: row.path,
        version: row.version,
        timestamp: row.created_at,
      }))
      .filter((event) => this.matchesAnyPathPattern(event.path, options.paths ?? []));
    return filtered;
  }

  private matchesAnyPathPattern(pathValue: string, patterns: string[]): boolean {
    if (patterns.length === 0) return true;
    return patterns.some((pattern) => this.matchesPathPattern(pathValue, pattern));
  }

  private matchesPathPattern(pathValue: string, pattern: string): boolean {
    const normalizedPath = pathValue.replaceAll('\\', '/');
    const normalizedPattern = pattern.replaceAll('\\', '/');
    if (normalizedPattern.endsWith('/**')) {
      const prefix = normalizedPattern.slice(0, -3);
      return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
    }
    if (normalizedPattern.includes('*')) {
      const escaped = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(normalizedPath);
    }
    return normalizedPath === normalizedPattern;
  }

  async vacuum(): Promise<void> {
    const db = this.ensureDb();
    db.exec('VACUUM');
  }

  async getStats(): Promise<StorageStats> {
    const db = this.ensureDb();

    const fnCount = db
      .prepare('SELECT COUNT(*) as count FROM librarian_functions')
      .get() as { count: number };
    const modCount = db
      .prepare('SELECT COUNT(*) as count FROM librarian_modules')
      .get() as { count: number };
    const packCount = db
      .prepare('SELECT COUNT(*) as count FROM librarian_context_packs WHERE invalidated = 0')
      .get() as { count: number };
    const embedCount = db
      .prepare('SELECT COUNT(*) as count FROM librarian_embeddings')
      .get() as { count: number };
    const avgConf = db
      .prepare('SELECT AVG(confidence) as avg FROM librarian_functions')
      .get() as { avg: number | null };

    // Approximate storage size
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const pageCount = db.pragma('page_count', { simple: true }) as number;

    return {
      totalFunctions: fnCount.count,
      totalModules: modCount.count,
      totalContextPacks: packCount.count,
      totalEmbeddings: embedCount.count,
      storageSizeBytes: pageSize * pageCount,
      lastVacuum: null, // Would need to track this separately
      averageConfidence: avgConf.avg || 0,
      cacheHitRate: 0, // Would need to track this in-memory
    };
  }

  // ==========================================================================
  // ADVANCED ANALYSIS: SCC (Strongly Connected Components)
  // ==========================================================================

  async getSCCEntries(options: SCCQueryOptions = {}): Promise<SCCEntry[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_scc WHERE 1=1';
    const params: unknown[] = [];

    if (options.componentId !== undefined) {
      sql += ' AND component_id = ?';
      params.push(options.componentId);
    }
    if (options.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options.minSize !== undefined) {
      sql += ' AND component_size >= ?';
      params.push(options.minSize);
    }
    if (options.onlyRoots) {
      sql += ' AND is_root = 1';
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as SCCRow[];
    return rows.map(rowToSCCEntry);
  }

  async getSCCByEntity(entityId: string, entityType: SCCEntry['entityType']): Promise<SCCEntry | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_scc WHERE entity_id = ? AND entity_type = ?')
      .get(entityId, entityType) as SCCRow | undefined;
    return row ? rowToSCCEntry(row) : null;
  }

  async upsertSCCEntries(entries: SCCEntry[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_scc
      (component_id, entity_id, entity_type, is_root, component_size, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: SCCEntry[]) => {
      for (const entry of entries) {
        stmt.run(
          entry.componentId,
          entry.entityId,
          entry.entityType,
          entry.isRoot ? 1 : 0,
          entry.componentSize,
          entry.computedAt
        );
      }
    });
    insertMany(entries);
  }

  async deleteSCCEntries(): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_scc').run();
  }

  // ==========================================================================
  // ADVANCED ANALYSIS: CFG (Control Flow Graph)
  // ==========================================================================

  async getCFGEdges(options: CFGQueryOptions = {}): Promise<CFGEdge[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_cfg_edges WHERE 1=1';
    const params: unknown[] = [];

    if (options.functionId) {
      sql += ' AND function_id = ?';
      params.push(options.functionId);
    }
    if (options.edgeType) {
      sql += ' AND edge_type = ?';
      params.push(options.edgeType);
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as CFGEdgeRow[];
    return rows.map(rowToCFGEdge);
  }

  async getCFGForFunction(functionId: string): Promise<CFGEdge[]> {
    return this.getCFGEdges({ functionId });
  }

  async upsertCFGEdges(edges: CFGEdge[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_cfg_edges
      (function_id, from_block, to_block, edge_type, condition, source_line, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((edges: CFGEdge[]) => {
      for (const edge of edges) {
        // Clamp confidence to [0, 1]
        const confidence = Math.max(0, Math.min(1, edge.confidence));
        stmt.run(
          edge.functionId,
          edge.fromBlock,
          edge.toBlock,
          edge.edgeType,
          edge.condition ?? null,
          edge.sourceLine ?? null,
          confidence
        );
      }
    });
    insertMany(edges);
  }

  async deleteCFGEdgesForFunction(functionId: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_cfg_edges WHERE function_id = ?').run(functionId);
  }

  // ==========================================================================
  // ADVANCED ANALYSIS: Bayesian Confidence
  // ==========================================================================

  async getBayesianConfidence(
    entityId: string,
    entityType: BayesianConfidence['entityType']
  ): Promise<BayesianConfidence | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_bayesian_confidence WHERE entity_id = ? AND entity_type = ?')
      .get(entityId, entityType) as BayesianConfidenceRow | undefined;
    return row ? rowToBayesianConfidence(row) : null;
  }

  async getBayesianConfidences(options: BayesianConfidenceQueryOptions = {}): Promise<BayesianConfidence[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_bayesian_confidence WHERE 1=1';
    const params: unknown[] = [];

    if (options.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options.minObservations !== undefined) {
      sql += ' AND observation_count >= ?';
      params.push(options.minObservations);
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as BayesianConfidenceRow[];
    return rows.map(rowToBayesianConfidence);
  }

  async upsertBayesianConfidence(entry: BayesianConfidence): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT OR REPLACE INTO librarian_bayesian_confidence
      (entity_id, entity_type, prior_alpha, prior_beta, posterior_alpha, posterior_beta,
       observation_count, last_observation, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.entityId,
      entry.entityType,
      entry.priorAlpha,
      entry.priorBeta,
      entry.posteriorAlpha,
      entry.posteriorBeta,
      entry.observationCount,
      entry.lastObservation ?? null,
      entry.computedAt
    );
  }

  async updateBayesianConfidence(
    entityId: string,
    entityType: BayesianConfidence['entityType'],
    success: boolean
  ): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    // Bayesian update: alpha += 1 on success, beta += 1 on failure
    if (success) {
      db.prepare(`
        UPDATE librarian_bayesian_confidence
        SET posterior_alpha = posterior_alpha + 1,
            observation_count = observation_count + 1,
            last_observation = ?,
            computed_at = ?
        WHERE entity_id = ? AND entity_type = ?
      `).run(now, now, entityId, entityType);
    } else {
      db.prepare(`
        UPDATE librarian_bayesian_confidence
        SET posterior_beta = posterior_beta + 1,
            observation_count = observation_count + 1,
            last_observation = ?,
            computed_at = ?
        WHERE entity_id = ? AND entity_type = ?
      `).run(now, now, entityId, entityType);
    }
  }

  // ==========================================================================
  // ADVANCED ANALYSIS: Stability Metrics
  // ==========================================================================

  async getStabilityMetrics(entityId: string, entityType: string): Promise<StabilityMetrics | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_stability_metrics WHERE entity_id = ? AND entity_type = ?')
      .get(entityId, entityType) as StabilityMetricsRow | undefined;
    return row ? rowToStabilityMetrics(row) : null;
  }

  async getStabilityMetricsList(options: StabilityQueryOptions = {}): Promise<StabilityMetrics[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_stability_metrics WHERE 1=1';
    const params: unknown[] = [];

    if (options.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options.minVolatility !== undefined) {
      sql += ' AND volatility >= ?';
      params.push(options.minVolatility);
    }
    if (options.maxVolatility !== undefined) {
      sql += ' AND volatility <= ?';
      params.push(options.maxVolatility);
    }
    if (options.trendDirection) {
      const threshold = 0.01; // Threshold for "stable"
      switch (options.trendDirection) {
        case 'increasing':
          sql += ' AND trend > ?';
          params.push(threshold);
          break;
        case 'decreasing':
          sql += ' AND trend < ?';
          params.push(-threshold);
          break;
        case 'stable':
          sql += ' AND trend >= ? AND trend <= ?';
          params.push(-threshold, threshold);
          break;
      }
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as StabilityMetricsRow[];
    return rows.map(rowToStabilityMetrics);
  }

  async upsertStabilityMetrics(metrics: StabilityMetrics): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT OR REPLACE INTO librarian_stability_metrics
      (entity_id, entity_type, volatility, trend, mean_reversion_rate, half_life_days,
       seasonality_period_days, last_change_delta, computed_at, window_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metrics.entityId,
      metrics.entityType,
      metrics.volatility,
      metrics.trend,
      metrics.meanReversionRate ?? null,
      metrics.halfLifeDays ?? null,
      metrics.seasonalityPeriodDays ?? null,
      metrics.lastChangeDelta ?? null,
      metrics.computedAt,
      metrics.windowDays
    );
  }

  // ==========================================================================
  // ADVANCED ANALYSIS: Feedback Loops
  // ==========================================================================

  async getFeedbackLoop(loopId: string): Promise<FeedbackLoop | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_feedback_loops WHERE loop_id = ?')
      .get(loopId) as FeedbackLoopRow | undefined;
    return row ? rowToFeedbackLoop(row) : null;
  }

  async getFeedbackLoops(options: FeedbackLoopQueryOptions = {}): Promise<FeedbackLoop[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_feedback_loops WHERE 1=1';
    const params: unknown[] = [];

    if (options.loopType) {
      sql += ' AND loop_type = ?';
      params.push(options.loopType);
    }
    if (options.severity) {
      sql += ' AND severity = ?';
      params.push(options.severity);
    }
    if (options.unresolvedOnly) {
      sql += ' AND resolved_at IS NULL';
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as FeedbackLoopRow[];
    return rows.map(rowToFeedbackLoop);
  }

  async upsertFeedbackLoop(loop: FeedbackLoop): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT OR REPLACE INTO librarian_feedback_loops
      (loop_id, loop_type, entities, severity, is_stable, cycle_length,
       detected_at, resolved_at, resolution_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      loop.loopId,
      loop.loopType,
      JSON.stringify(loop.entities),
      loop.severity,
      loop.isStable ? 1 : 0,
      loop.cycleLength,
      loop.detectedAt,
      loop.resolvedAt ?? null,
      loop.resolutionMethod ?? null
    );
  }

  async resolveFeedbackLoop(loopId: string, resolutionMethod: string): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE librarian_feedback_loops
      SET resolved_at = ?, resolution_method = ?
      WHERE loop_id = ?
    `).run(now, resolutionMethod, loopId);
  }

  // ==========================================================================
  // ADVANCED ANALYSIS: Graph Cache
  // ==========================================================================

  async getGraphCacheEntry(cacheKey: string): Promise<GraphCacheEntry | null> {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM librarian_graph_cache WHERE cache_key = ?')
      .get(cacheKey) as GraphCacheRow | undefined;
    return row ? rowToGraphCacheEntry(row) : null;
  }

  async upsertGraphCacheEntry(entry: GraphCacheEntry): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT OR REPLACE INTO librarian_graph_cache
      (cache_key, analysis_type, result, node_count, edge_count,
       computation_ms, computed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.cacheKey,
      entry.analysisType,
      entry.result,
      entry.nodeCount,
      entry.edgeCount,
      entry.computationMs,
      entry.computedAt,
      entry.expiresAt
    );
  }

  async pruneExpiredGraphCache(): Promise<number> {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    const result = db.prepare('DELETE FROM librarian_graph_cache WHERE expires_at < ?').run(now);
    return result.changes;
  }

  // ==========================================================================
  // ADVANCED LIBRARY FEATURES (Migration 011)
  // ==========================================================================

  // Git Blame methods
  async getBlameEntries(options?: BlameQueryOptions): Promise<BlameEntry[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_blame_entries WHERE 1=1';
    const params: unknown[] = [];

    if (options?.filePath) {
      sql += ' AND file_path = ?';
      params.push(options.filePath);
    }
    if (options?.author) {
      sql += ' AND author = ?';
      params.push(options.author);
    }
    if (options?.commitHash) {
      sql += ' AND commit_hash = ?';
      params.push(options.commitHash);
    }
    if (options?.lineRange) {
      sql += ' AND line_start >= ? AND line_end <= ?';
      params.push(options.lineRange.start, options.lineRange.end);
    }

    sql += ` ORDER BY ${options?.orderBy === 'commit_date' ? 'commit_date' : 'line_start'} ${options?.orderDirection === 'desc' ? 'DESC' : 'ASC'}`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as BlameRow[];
    return rows.map(rowToBlameEntry);
  }

  async getBlameForFile(filePath: string): Promise<BlameEntry[]> {
    return this.getBlameEntries({ filePath, orderBy: 'line_start', orderDirection: 'asc' });
  }

  async getBlameStats(filePath: string): Promise<BlameStats | null> {
    const db = this.ensureDb();
    const entries = await this.getBlameForFile(filePath);
    if (entries.length === 0) return null;

    const authorsByLines: Record<string, number> = {};
    let totalLines = 0;
    let lastModified = '';
    let topContributor = '';
    let maxLines = 0;

    for (const entry of entries) {
      const lineCount = entry.lineEnd - entry.lineStart + 1;
      totalLines += lineCount;
      authorsByLines[entry.author] = (authorsByLines[entry.author] || 0) + lineCount;
      if (entry.commitDate > lastModified) {
        lastModified = entry.commitDate;
      }
      if (authorsByLines[entry.author] > maxLines) {
        maxLines = authorsByLines[entry.author];
        topContributor = entry.author;
      }
    }

    const expertiseByAuthor: Record<string, number> = {};
    for (const [author, lines] of Object.entries(authorsByLines)) {
      expertiseByAuthor[author] = totalLines > 0 ? lines / totalLines : 0;
    }

    return {
      filePath,
      totalLines,
      authorsByLines,
      expertiseByAuthor,
      lastModified,
      topContributor,
    };
  }

  async upsertBlameEntries(entries: BlameEntry[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_blame_entries
      (id, file_path, line_start, line_end, author, author_email, commit_hash, commit_date, original_line, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: BlameEntry[]) => {
      for (const entry of entries) {
        stmt.run(
          entry.id,
          entry.filePath,
          entry.lineStart,
          entry.lineEnd,
          entry.author,
          entry.authorEmail || null,
          entry.commitHash,
          entry.commitDate,
          entry.originalLine || null,
          entry.indexedAt
        );
      }
    });

    insertMany(entries);
  }

  async deleteBlameForFile(filePath: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_blame_entries WHERE file_path = ?').run(filePath);
    return result.changes;
  }

  // Git Diff methods
  async getDiffRecords(options?: DiffQueryOptions): Promise<DiffRecord[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_diff_records WHERE 1=1';
    const params: unknown[] = [];

    if (options?.commitHash) {
      sql += ' AND commit_hash = ?';
      params.push(options.commitHash);
    }
    if (options?.filePath) {
      sql += ' AND file_path = ?';
      params.push(options.filePath);
    }
    if (options?.changeCategory) {
      sql += ' AND change_category = ?';
      params.push(options.changeCategory);
    }
    if (options?.minComplexity !== undefined) {
      sql += ' AND complexity >= ?';
      params.push(options.minComplexity);
    }
    if (options?.minImpact !== undefined) {
      sql += ' AND impact_score >= ?';
      params.push(options.minImpact);
    }

    const orderCol = options?.orderBy === 'complexity' ? 'complexity' :
                     options?.orderBy === 'impact_score' ? 'impact_score' : 'indexed_at';
    sql += ` ORDER BY ${orderCol} ${options?.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as DiffRow[];
    return rows.map(rowToDiffRecord);
  }

  async getDiffForCommit(commitHash: string): Promise<DiffRecord[]> {
    return this.getDiffRecords({ commitHash });
  }

  async upsertDiffRecords(records: DiffRecord[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_diff_records
      (id, commit_hash, file_path, additions, deletions, hunk_count, hunks, change_category, complexity, impact_score, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((records: DiffRecord[]) => {
      for (const record of records) {
        stmt.run(
          record.id,
          record.commitHash,
          record.filePath,
          record.additions,
          record.deletions,
          record.hunkCount,
          JSON.stringify(record.hunks),
          record.changeCategory,
          record.complexity,
          record.impactScore,
          record.indexedAt
        );
      }
    });

    insertMany(records);
  }

  async deleteDiffForCommit(commitHash: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_diff_records WHERE commit_hash = ?').run(commitHash);
    return result.changes;
  }

  // Git Reflog methods
  async getReflogEntries(options?: ReflogQueryOptions): Promise<ReflogEntry[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_reflog_entries WHERE 1=1';
    const params: unknown[] = [];

    if (options?.refName) {
      sql += ' AND ref_name = ?';
      params.push(options.refName);
    }
    if (options?.action) {
      sql += ' AND action = ?';
      params.push(options.action);
    }
    if (options?.commitHash) {
      sql += ' AND commit_hash = ?';
      params.push(options.commitHash);
    }
    if (options?.author) {
      sql += ' AND author = ?';
      params.push(options.author);
    }
    if (options?.sinceTimestamp) {
      sql += ' AND timestamp >= ?';
      params.push(options.sinceTimestamp);
    }

    sql += ` ORDER BY timestamp ${options?.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as ReflogRow[];
    return rows.map(rowToReflogEntry);
  }

  async upsertReflogEntries(entries: ReflogEntry[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_reflog_entries
      (id, ref_name, commit_hash, action, previous_commit, timestamp, message, author, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: ReflogEntry[]) => {
      for (const entry of entries) {
        stmt.run(
          entry.id,
          entry.refName,
          entry.commitHash,
          entry.action,
          entry.previousCommit || null,
          entry.timestamp,
          entry.message || null,
          entry.author || null,
          entry.indexedAt
        );
      }
    });

    insertMany(entries);
  }

  async deleteReflogEntries(beforeTimestamp: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_reflog_entries WHERE timestamp < ?').run(beforeTimestamp);
    return result.changes;
  }

  // Code Clone methods
  async getCloneEntries(options?: CloneQueryOptions): Promise<CloneEntry[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_clone_entries WHERE 1=1';
    const params: unknown[] = [];

    if (options?.cloneGroupId !== undefined) {
      sql += ' AND clone_group_id = ?';
      params.push(options.cloneGroupId);
    }
    if (options?.entityId) {
      sql += ' AND (entity_id_1 = ? OR entity_id_2 = ?)';
      params.push(options.entityId, options.entityId);
    }
    if (options?.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options?.cloneType) {
      sql += ' AND clone_type = ?';
      params.push(options.cloneType);
    }
    if (options?.minSimilarity !== undefined) {
      sql += ' AND similarity >= ?';
      params.push(options.minSimilarity);
    }
    if (options?.minRefactoringPotential !== undefined) {
      sql += ' AND refactoring_potential >= ?';
      params.push(options.minRefactoringPotential);
    }

    const orderCol = options?.orderBy === 'similarity' ? 'similarity' :
                     options?.orderBy === 'refactoring_potential' ? 'refactoring_potential' : 'computed_at';
    sql += ` ORDER BY ${orderCol} ${options?.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as CloneRow[];
    return rows.map(rowToCloneEntry);
  }

  async getClonesByEntity(entityId: string): Promise<CloneEntry[]> {
    return this.getCloneEntries({ entityId, orderBy: 'similarity', orderDirection: 'desc' });
  }

  async getCloneClusters(): Promise<CloneCluster[]> {
    const db = this.ensureDb();
    const sql = `
      SELECT
        clone_group_id as clusterId,
        clone_type as cloneType,
        COUNT(*) as memberCount,
        AVG(similarity) as avgSimilarity,
        SUM(COALESCE(shared_lines, 0)) as totalDuplicatedLines
      FROM librarian_clone_entries
      GROUP BY clone_group_id, clone_type
      ORDER BY memberCount DESC
    `;
    const rows = db.prepare(sql).all() as Array<{
      clusterId: number;
      cloneType: string;
      memberCount: number;
      avgSimilarity: number;
      totalDuplicatedLines: number;
    }>;

    return rows.map(row => ({
      clusterId: row.clusterId,
      cloneType: row.cloneType as CloneEntry['cloneType'],
      memberCount: row.memberCount,
      avgSimilarity: row.avgSimilarity,
      totalDuplicatedLines: row.totalDuplicatedLines,
      refactoringEffort: row.memberCount <= 2 ? 'trivial' as const :
                         row.memberCount <= 5 ? 'easy' as const :
                         row.memberCount <= 10 ? 'moderate' as const : 'hard' as const,
      suggestedAction: 'extract_function' as const,
    }));
  }

  async upsertCloneEntries(entries: CloneEntry[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_clone_entries
      (clone_group_id, entity_id_1, entity_id_2, entity_type, similarity, clone_type, shared_lines, shared_tokens, refactoring_potential, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: CloneEntry[]) => {
      for (const entry of entries) {
        stmt.run(
          entry.cloneGroupId,
          entry.entityId1,
          entry.entityId2,
          entry.entityType,
          entry.similarity,
          entry.cloneType,
          entry.sharedLines || null,
          entry.sharedTokens || null,
          entry.refactoringPotential,
          entry.computedAt
        );
      }
    });

    insertMany(entries);
  }

  async deleteCloneEntries(): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_clone_entries').run();
    return result.changes;
  }

  // Technical Debt methods
  async getDebtMetrics(options?: DebtQueryOptions): Promise<DebtMetrics[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_debt_metrics WHERE 1=1';
    const params: unknown[] = [];

    if (options?.entityId) {
      sql += ' AND entity_id = ?';
      params.push(options.entityId);
    }
    if (options?.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options?.trend) {
      sql += ' AND trend = ?';
      params.push(options.trend);
    }
    if (options?.priority) {
      sql += ' AND priority = ?';
      params.push(options.priority);
    }
    if (options?.minDebt !== undefined) {
      sql += ' AND total_debt >= ?';
      params.push(options.minDebt);
    }
    if (options?.maxDebt !== undefined) {
      sql += ' AND total_debt <= ?';
      params.push(options.maxDebt);
    }

    const orderCol = options?.orderBy === 'total_debt' ? 'total_debt' :
                     options?.orderBy === 'priority' ? 'priority' :
                     options?.orderBy === 'estimated_fix_hours' ? 'estimated_fix_hours' : 'computed_at';
    sql += ` ORDER BY ${orderCol} ${options?.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as DebtRow[];
    return rows.map(rowToDebtMetrics);
  }

  async getDebtForEntity(entityId: string, entityType: DebtMetrics['entityType']): Promise<DebtMetrics | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM librarian_debt_metrics WHERE entity_id = ? AND entity_type = ?')
      .get(entityId, entityType) as DebtRow | undefined;
    return row ? rowToDebtMetrics(row) : null;
  }

  async getDebtHotspots(limit?: number): Promise<DebtHotspot[]> {
    const db = this.ensureDb();
    const sql = `
      SELECT entity_id, entity_type, total_debt,
             complexity_debt, duplication_debt, coupling_debt, coverage_debt,
             architecture_debt, churn_debt, documentation_debt, security_debt
      FROM librarian_debt_metrics
      ORDER BY total_debt DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(limit ?? 20) as DebtRow[];

    return rows.map(row => {
      const categories = {
        complexityDebt: row.complexity_debt,
        duplicationDebt: row.duplication_debt,
        couplingDebt: row.coupling_debt,
        coverageDebt: row.coverage_debt,
        architectureDebt: row.architecture_debt,
        churnDebt: row.churn_debt,
        documentationDebt: row.documentation_debt,
        securityDebt: row.security_debt,
      };
      const maxCategory = Object.entries(categories).reduce((a, b) => a[1] > b[1] ? a : b);

      return {
        entityId: row.entity_id,
        entityType: row.entity_type as DebtMetrics['entityType'],
        path: row.entity_id, // In practice, this would be resolved from files table
        totalDebt: row.total_debt,
        dominantCategory: maxCategory[0] as keyof typeof categories,
        impactRadius: 1, // Would need graph analysis to compute properly
        fixComplexity: row.total_debt < 20 ? 'trivial' as const :
                       row.total_debt < 40 ? 'easy' as const :
                       row.total_debt < 60 ? 'moderate' as const :
                       row.total_debt < 80 ? 'hard' as const : 'epic' as const,
      };
    });
  }

  async upsertDebtMetrics(metrics: DebtMetrics[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_debt_metrics
      (entity_id, entity_type, total_debt, complexity_debt, duplication_debt, coupling_debt,
       coverage_debt, architecture_debt, churn_debt, documentation_debt, security_debt,
       trend, trend_delta, velocity_per_day, estimated_fix_hours, priority, recommendations,
       confidence_alpha, confidence_beta, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((metrics: DebtMetrics[]) => {
      for (const m of metrics) {
        stmt.run(
          m.entityId,
          m.entityType,
          m.totalDebt,
          m.complexityDebt,
          m.duplicationDebt,
          m.couplingDebt,
          m.coverageDebt,
          m.architectureDebt,
          m.churnDebt,
          m.documentationDebt,
          m.securityDebt,
          m.trend,
          m.trendDelta,
          m.velocityPerDay,
          m.estimatedFixHours,
          m.priority,
          JSON.stringify(m.recommendations),
          m.confidenceAlpha,
          m.confidenceBeta,
          m.computedAt
        );
      }
    });

    insertMany(metrics);
  }

  async deleteDebtMetrics(entityId: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_debt_metrics WHERE entity_id = ?').run(entityId);
  }

  // Knowledge Graph methods
  async getKnowledgeEdges(options?: KnowledgeEdgeQueryOptions): Promise<KnowledgeGraphEdge[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_knowledge_edges WHERE 1=1';
    const params: unknown[] = [];

    if (options?.sourceId) {
      sql += ' AND source_id = ?';
      params.push(options.sourceId);
    }
    if (options?.targetId) {
      sql += ' AND target_id = ?';
      params.push(options.targetId);
    }
    if (options?.sourceType) {
      sql += ' AND source_type = ?';
      params.push(options.sourceType);
    }
    if (options?.targetType) {
      sql += ' AND target_type = ?';
      params.push(options.targetType);
    }
    if (options?.edgeType) {
      sql += ' AND edge_type = ?';
      params.push(options.edgeType);
    }
    if (options?.minWeight !== undefined) {
      sql += ' AND weight >= ?';
      params.push(options.minWeight);
    }
    if (options?.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    const orderCol = options?.orderBy === 'weight' ? 'weight' :
                     options?.orderBy === 'confidence' ? 'confidence' : 'computed_at';
    sql += ` ORDER BY ${orderCol} ${options?.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as KnowledgeEdgeRow[];
    return rows.map(rowToKnowledgeEdge);
  }

  async getKnowledgeEdgesFrom(sourceId: string): Promise<KnowledgeGraphEdge[]> {
    return this.getKnowledgeEdges({ sourceId });
  }

  async getKnowledgeEdgesTo(targetId: string): Promise<KnowledgeGraphEdge[]> {
    return this.getKnowledgeEdges({ targetId });
  }

  async getKnowledgeSubgraph(rootId: string, depth: number, edgeTypes?: KnowledgeEdgeType[]): Promise<KnowledgeSubgraph> {
    const db = this.ensureDb();
    const visited = new Set<string>();
    const nodes: KnowledgeSubgraph['nodes'] = [];
    const edges: KnowledgeGraphEdge[] = [];
    const queue: Array<{ id: string; currentDepth: number }> = [{ id: rootId, currentDepth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.currentDepth > depth) continue;
      visited.add(current.id);

      // Get outgoing edges
      let sql = 'SELECT * FROM librarian_knowledge_edges WHERE source_id = ?';
      const params: unknown[] = [current.id];
      if (edgeTypes?.length) {
        sql += ` AND edge_type IN (${edgeTypes.map(() => '?').join(',')})`;
        params.push(...edgeTypes);
      }

      const outEdges = db.prepare(sql).all(...params) as KnowledgeEdgeRow[];
      for (const row of outEdges) {
        const edge = rowToKnowledgeEdge(row);
        edges.push(edge);
        if (!visited.has(edge.targetId)) {
          queue.push({ id: edge.targetId, currentDepth: current.currentDepth + 1 });
        }
      }
    }

    // Build nodes from visited IDs
    for (const id of visited) {
      // Try to get node info from first edge involving this node
      const edge = edges.find(e => e.sourceId === id || e.targetId === id);
      nodes.push({
        id,
        type: edge?.sourceId === id ? edge.sourceType : edge?.targetType ?? 'function',
        label: id.split('/').pop() ?? id,
        properties: {},
      });
    }

    const density = nodes.length > 1 ? (2 * edges.length) / (nodes.length * (nodes.length - 1)) : 0;
    const avgDegree = nodes.length > 0 ? (2 * edges.length) / nodes.length : 0;

    return {
      nodes,
      edges,
      metrics: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        density,
        avgDegree,
      },
    };
  }

  async upsertKnowledgeEdges(edges: KnowledgeGraphEdge[]): Promise<void> {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librarian_knowledge_edges
      (id, source_id, target_id, source_type, target_type, edge_type, weight, confidence, metadata, computed_at, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((edges: KnowledgeGraphEdge[]) => {
      for (const edge of edges) {
        stmt.run(
          edge.id,
          edge.sourceId,
          edge.targetId,
          edge.sourceType,
          edge.targetType,
          edge.edgeType,
          edge.weight,
          edge.confidence,
          JSON.stringify(edge.metadata),
          edge.computedAt,
          edge.validUntil || null
        );
      }
    });

    insertMany(edges);
  }

  async deleteKnowledgeEdge(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_knowledge_edges WHERE id = ?').run(id);
  }

  async deleteKnowledgeEdgesForEntity(entityId: string): Promise<number> {
    const db = this.ensureDb();
    const result = db.prepare('DELETE FROM librarian_knowledge_edges WHERE source_id = ? OR target_id = ?')
      .run(entityId, entityId);
    return result.changes;
  }

  // Fault Localization methods
  async getFaultLocalizations(options?: FaultLocalizationQueryOptions): Promise<FaultLocalization[]> {
    const db = this.ensureDb();
    let sql = 'SELECT * FROM librarian_fault_localizations WHERE 1=1';
    const params: unknown[] = [];

    if (options?.failureSignature) {
      sql += ' AND failure_signature LIKE ?';
      params.push(`%${options.failureSignature}%`);
    }
    if (options?.entityId) {
      sql += ' AND suspicious_entities LIKE ?';
      params.push(`%${options.entityId}%`);
    }
    if (options?.methodology) {
      sql += ' AND methodology = ?';
      params.push(options.methodology);
    }
    if (options?.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    sql += ' ORDER BY computed_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as FaultLocalizationRow[];
    return rows.map(rowToFaultLocalization);
  }

  async upsertFaultLocalization(localization: FaultLocalization): Promise<void> {
    const db = this.ensureDb();
    db.prepare(`
      INSERT OR REPLACE INTO librarian_fault_localizations
      (id, failure_signature, suspicious_entities, methodology, confidence, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      localization.id,
      localization.failureSignature,
      JSON.stringify(localization.suspiciousEntities),
      localization.methodology,
      localization.confidence,
      localization.computedAt
    );
  }

  async deleteFaultLocalization(id: string): Promise<void> {
    const db = this.ensureDb();
    db.prepare('DELETE FROM librarian_fault_localizations WHERE id = ?').run(id);
  }
}

// ============================================================================
// ADVANCED LIBRARY FEATURES ROW TYPES (Migration 011)
// ============================================================================

interface BlameRow {
  id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  author: string;
  author_email: string | null;
  commit_hash: string;
  commit_date: string;
  original_line: number | null;
  indexed_at: string;
}

interface DiffRow {
  id: string;
  commit_hash: string;
  file_path: string;
  additions: number;
  deletions: number;
  hunk_count: number;
  hunks: string;
  change_category: string;
  complexity: number;
  impact_score: number;
  indexed_at: string;
}

interface ReflogRow {
  id: string;
  ref_name: string;
  commit_hash: string;
  action: string;
  previous_commit: string | null;
  timestamp: string;
  message: string | null;
  author: string | null;
  indexed_at: string;
}

interface CloneRow {
  clone_group_id: number;
  entity_id_1: string;
  entity_id_2: string;
  entity_type: string;
  similarity: number;
  clone_type: string;
  shared_lines: number | null;
  shared_tokens: number | null;
  refactoring_potential: number;
  computed_at: string;
}

interface DebtRow {
  entity_id: string;
  entity_type: string;
  total_debt: number;
  complexity_debt: number;
  duplication_debt: number;
  coupling_debt: number;
  coverage_debt: number;
  architecture_debt: number;
  churn_debt: number;
  documentation_debt: number;
  security_debt: number;
  trend: string;
  trend_delta: number;
  velocity_per_day: number;
  estimated_fix_hours: number;
  priority: string;
  recommendations: string;
  confidence_alpha: number;
  confidence_beta: number;
  computed_at: string;
}

interface KnowledgeEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  source_type: string;
  target_type: string;
  edge_type: string;
  weight: number;
  confidence: number;
  metadata: string;
  computed_at: string;
  valid_until: string | null;
}

interface FaultLocalizationRow {
  id: string;
  failure_signature: string;
  suspicious_entities: string;
  methodology: string;
  confidence: number;
  computed_at: string;
}

// Row converters for migration 011 types
function rowToBlameEntry(row: BlameRow): BlameEntry {
  return {
    id: row.id,
    filePath: row.file_path,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    author: row.author,
    authorEmail: row.author_email ?? '',
    commitHash: row.commit_hash,
    commitDate: row.commit_date,
    originalLine: row.original_line ?? undefined,
    indexedAt: row.indexed_at,
  };
}

function rowToDiffRecord(row: DiffRow): DiffRecord {
  let hunks: DiffHunk[] = [];
  try {
    hunks = JSON.parse(row.hunks);
  } catch {
    // Use empty array if parsing fails
  }
  return {
    id: row.id,
    commitHash: row.commit_hash,
    filePath: row.file_path,
    additions: row.additions,
    deletions: row.deletions,
    hunkCount: row.hunk_count,
    hunks,
    changeCategory: row.change_category as DiffRecord['changeCategory'],
    complexity: row.complexity,
    impactScore: row.impact_score,
    indexedAt: row.indexed_at,
  };
}

function rowToReflogEntry(row: ReflogRow): ReflogEntry {
  return {
    id: row.id,
    refName: row.ref_name,
    commitHash: row.commit_hash,
    action: row.action as ReflogEntry['action'],
    previousCommit: row.previous_commit ?? undefined,
    timestamp: row.timestamp,
    message: row.message ?? '',
    author: row.author ?? undefined,
    indexedAt: row.indexed_at,
  };
}

function rowToCloneEntry(row: CloneRow): CloneEntry {
  return {
    cloneGroupId: row.clone_group_id,
    entityId1: row.entity_id_1,
    entityId2: row.entity_id_2,
    entityType: row.entity_type as CloneEntry['entityType'],
    similarity: row.similarity,
    cloneType: row.clone_type as CloneEntry['cloneType'],
    sharedLines: row.shared_lines ?? undefined,
    sharedTokens: row.shared_tokens ?? undefined,
    refactoringPotential: row.refactoring_potential,
    computedAt: row.computed_at,
  };
}

function rowToDebtMetrics(row: DebtRow): DebtMetrics {
  let recommendations: string[] = [];
  try {
    recommendations = JSON.parse(row.recommendations);
  } catch {
    // Use empty array if parsing fails
  }
  return {
    entityId: row.entity_id,
    entityType: row.entity_type as DebtMetrics['entityType'],
    totalDebt: row.total_debt,
    complexityDebt: row.complexity_debt,
    duplicationDebt: row.duplication_debt,
    couplingDebt: row.coupling_debt,
    coverageDebt: row.coverage_debt,
    architectureDebt: row.architecture_debt,
    churnDebt: row.churn_debt,
    documentationDebt: row.documentation_debt,
    securityDebt: row.security_debt,
    trend: row.trend as DebtMetrics['trend'],
    trendDelta: row.trend_delta,
    velocityPerDay: row.velocity_per_day,
    estimatedFixHours: row.estimated_fix_hours,
    priority: row.priority as DebtMetrics['priority'],
    recommendations,
    confidenceAlpha: row.confidence_alpha,
    confidenceBeta: row.confidence_beta,
    computedAt: row.computed_at,
  };
}

function rowToKnowledgeEdge(row: KnowledgeEdgeRow): KnowledgeGraphEdge {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata);
  } catch {
    // Use empty object if parsing fails
  }
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    sourceType: row.source_type as KnowledgeGraphEdge['sourceType'],
    targetType: row.target_type as KnowledgeGraphEdge['targetType'],
    edgeType: row.edge_type as KnowledgeEdgeType,
    weight: row.weight,
    confidence: row.confidence,
    metadata,
    computedAt: row.computed_at,
    validUntil: row.valid_until ?? undefined,
  };
}

function rowToFaultLocalization(row: FaultLocalizationRow): FaultLocalization {
  let suspiciousEntities: FaultLocalization['suspiciousEntities'] = [];
  try {
    suspiciousEntities = JSON.parse(row.suspicious_entities);
  } catch {
    // Use empty array if parsing fails
  }
  return {
    id: row.id,
    failureSignature: row.failure_signature,
    suspiciousEntities,
    methodology: row.methodology as FaultLocalization['methodology'],
    confidence: row.confidence,
    computedAt: row.computed_at,
  };
}

// ============================================================================
// ADVANCED ANALYSIS ROW TYPES
// ============================================================================

interface SCCRow {
  component_id: number;
  entity_id: string;
  entity_type: string;
  is_root: number;
  component_size: number;
  computed_at: string;
}

interface CFGEdgeRow {
  function_id: string;
  from_block: number;
  to_block: number;
  edge_type: string;
  condition: string | null;
  source_line: number | null;
  confidence: number;
}

interface BayesianConfidenceRow {
  entity_id: string;
  entity_type: string;
  prior_alpha: number;
  prior_beta: number;
  posterior_alpha: number;
  posterior_beta: number;
  observation_count: number;
  last_observation: string | null;
  computed_at: string;
}

interface StabilityMetricsRow {
  entity_id: string;
  entity_type: string;
  volatility: number;
  trend: number;
  mean_reversion_rate: number | null;
  half_life_days: number | null;
  seasonality_period_days: number | null;
  last_change_delta: number | null;
  computed_at: string;
  window_days: number;
}

interface FeedbackLoopRow {
  loop_id: string;
  loop_type: string;
  entities: string;
  severity: string;
  is_stable: number;
  cycle_length: number;
  detected_at: string;
  resolved_at: string | null;
  resolution_method: string | null;
}

interface GraphCacheRow {
  cache_key: string;
  analysis_type: string;
  result: string;
  node_count: number;
  edge_count: number;
  computation_ms: number;
  computed_at: string;
  expires_at: string;
}

function rowToSCCEntry(row: SCCRow): SCCEntry {
  return {
    componentId: row.component_id,
    entityId: row.entity_id,
    entityType: row.entity_type as SCCEntry['entityType'],
    isRoot: row.is_root === 1,
    componentSize: row.component_size,
    computedAt: row.computed_at,
  };
}

function rowToCFGEdge(row: CFGEdgeRow): CFGEdge {
  return {
    functionId: row.function_id,
    fromBlock: row.from_block,
    toBlock: row.to_block,
    edgeType: row.edge_type as CFGEdge['edgeType'],
    condition: row.condition ?? undefined,
    sourceLine: row.source_line ?? undefined,
    confidence: row.confidence,
  };
}

function rowToBayesianConfidence(row: BayesianConfidenceRow): BayesianConfidence {
  return {
    entityId: row.entity_id,
    entityType: row.entity_type as BayesianConfidence['entityType'],
    priorAlpha: row.prior_alpha,
    priorBeta: row.prior_beta,
    posteriorAlpha: row.posterior_alpha,
    posteriorBeta: row.posterior_beta,
    observationCount: row.observation_count,
    lastObservation: row.last_observation ?? undefined,
    computedAt: row.computed_at,
  };
}

function rowToStabilityMetrics(row: StabilityMetricsRow): StabilityMetrics {
  return {
    entityId: row.entity_id,
    entityType: row.entity_type,
    volatility: row.volatility,
    trend: row.trend,
    meanReversionRate: row.mean_reversion_rate ?? undefined,
    halfLifeDays: row.half_life_days ?? undefined,
    seasonalityPeriodDays: row.seasonality_period_days ?? undefined,
    lastChangeDelta: row.last_change_delta ?? undefined,
    computedAt: row.computed_at,
    windowDays: row.window_days,
  };
}

function rowToFeedbackLoop(row: FeedbackLoopRow): FeedbackLoop {
  let entities: string[] = [];
  try {
    const parsed = JSON.parse(row.entities);
    if (Array.isArray(parsed)) {
      entities = parsed;
    }
  } catch {
    // Use empty array if parsing fails
  }

  return {
    loopId: row.loop_id,
    loopType: row.loop_type as FeedbackLoop['loopType'],
    entities,
    severity: row.severity as FeedbackLoop['severity'],
    isStable: row.is_stable === 1,
    cycleLength: row.cycle_length,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionMethod: row.resolution_method ?? undefined,
  };
}

function rowToGraphCacheEntry(row: GraphCacheRow): GraphCacheEntry {
  return {
    cacheKey: row.cache_key,
    analysisType: row.analysis_type,
    result: row.result,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    computationMs: row.computation_ms,
    computedAt: row.computed_at,
    expiresAt: row.expires_at,
  };
}

// ============================================================================
// ROW TYPES
// ============================================================================

interface FunctionRow {
  id: string;
  file_path: string;
  name: string;
  signature: string;
  purpose: string;
  start_line: number;
  end_line: number;
  is_pure: number;
  has_side_effects: number;
  modifies_params: number;
  throws: number;
  return_depends_on_inputs: number;
  effect_signature: string;
  confidence: number;
  access_count: number;
  last_accessed: string | null;
  validation_count: number;
  outcome_successes: number;
  outcome_failures: number;
}

interface ModuleRow {
  id: string;
  path: string;
  purpose: string;
  exports: string;
  dependencies: string;
  confidence: number;
}

interface ContextPackRow {
  pack_id: string;
  pack_type: string;
  target_id: string;
  schema_version: number;
  content_hash: string;
  summary: string;
  key_facts: string;
  code_snippets: string;
  related_files: string;
  confidence: number;
  created_at: string;
  access_count: number;
  last_outcome: string;
  success_count: number;
  failure_count: number;
  version_string: string;
  invalidation_triggers: string;
}

interface QueryCacheRow {
  query_hash: string;
  query_params: string;
  response: string;
  created_at: string;
  last_accessed: string;
  access_count: number;
}

interface RetrievalConfidenceLogRow {
  query_hash: string;
  confidence_score: number;
  retrieval_entropy: number;
  returned_pack_ids: string;
  timestamp: string;
  intent: string | null;
  from_depth: string | null;
  to_depth: string | null;
  escalation_reason: string | null;
  attempt: number | null;
  max_escalation_depth: number | null;
  routed_strategy: string | null;
}

interface RetrievalStrategyRewardRow {
  strategy_id: string;
  intent_type: string;
  success_count: number;
  failure_count: number;
  last_updated: string;
}

interface RetrievalStrategySelectionRow {
  query_id: string;
  strategy_id: string;
  intent_type: string;
  created_at: string;
  feedback_outcome: 'success' | 'failure' | 'partial' | null;
  feedback_recorded_at: string | null;
}

interface QueryAccessLogRow {
  entity_id: string;
  entity_type: 'function' | 'module';
  last_queried_at: string;
  query_count: number;
}

interface ExplorationMetricRow {
  entity_id: string;
  entity_type: 'function' | 'module';
  pagerank: number;
  betweenness: number;
  closeness: number;
  eigenvector: number;
  query_count: number | null;
  last_queried_at: string | null;
}

interface ExplorationDependentRow {
  entity_id: string;
  dependent_count: number;
}

interface IndexingHistoryRow {
  id: string;
  task_type: string;
  started_at: string;
  completed_at: string;
  files_processed: number;
  files_skipped: number;
  functions_indexed: number;
  modules_indexed: number;
  context_packs_created: number;
  errors: string;
  version_string: string;
}

interface BootstrapHistoryRow {
  id: string;
  workspace: string;
  started_at: string;
  completed_at: string | null;
  phases: string;
  total_files: number;
  total_functions: number;
  total_context_packs: number;
  version_string: string;
  success: number;
  error: string | null;
}

interface TestMappingRow {
  id: string;
  test_path: string;
  source_path: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

interface CommitRow {
  id: string;
  sha: string;
  message: string;
  author: string;
  category: string;
  files_changed: string;
  created_at: string;
}

interface OwnershipRow {
  id: string;
  file_path: string;
  author: string;
  score: number;
  last_modified: string;
  created_at: string;
}

interface UniversalKnowledgeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file: string;
  line: number;
  knowledge: string;
  purpose_summary: string | null;
  maintainability_index: number | null;
  risk_score: number | null;
  test_coverage: number | null;
  cyclomatic_complexity: number | null;
  cognitive_complexity: string | null;
  embedding: Buffer | null;
  confidence: number;
  generated_at: string;
  valid_until: string | null;
  hash: string;
}

interface FileKnowledgeRow {
  id: string;
  path: string;
  relative_path: string;
  name: string;
  extension: string;
  category: string;
  purpose: string;
  role: string;
  summary: string;
  key_exports: string;
  main_concepts: string;
  line_count: number;
  function_count: number;
  class_count: number;
  import_count: number;
  export_count: number;
  imports: string;
  imported_by: string;
  directory: string;
  complexity: string;
  test_coverage: number | null;
  has_tests: number;
  checksum: string;
  confidence: number;
  last_indexed: string;
  last_modified: string;
  llm_evidence: string | null;
}

interface DirectoryKnowledgeRow {
  id: string;
  path: string;
  relative_path: string;
  name: string;
  fingerprint?: string;
  purpose: string;
  role: string;
  description: string;
  bounded_context: string | null;
  pattern: string;
  depth: number;
  file_count: number;
  subdirectory_count: number;
  total_files: number;
  main_files: string;
  subdirectories: string;
  file_types: string;
  parent: string | null;
  siblings: string;
  related_directories: string;
  has_readme: number;
  has_index: number;
  has_tests: number;
  complexity: string;
  confidence: number;
  last_indexed: string;
  llm_evidence: string | null;
}

interface AssessmentRow {
  entity_id: string;
  entity_type: string;
  entity_path: string;
  findings: string;
  overall_health: string;
  health_score: number;
  quick_summary: string;
  assessed_at: string;
}

// ============================================================================
// ROW CONVERTERS
// ============================================================================

function rowToTestMapping(row: TestMappingRow): TestMapping {
  return {
    id: row.id,
    testPath: row.test_path,
    sourcePath: row.source_path,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToCommit(row: CommitRow): LiBrainianCommit {
  return {
    id: row.id,
    sha: row.sha,
    message: row.message,
    author: row.author,
    category: row.category,
    filesChanged: parseStringArray(row.files_changed),
    createdAt: new Date(row.created_at),
  };
}

function rowToOwnership(row: OwnershipRow): FileOwnership {
  return {
    id: row.id,
    filePath: row.file_path,
    author: row.author,
    score: row.score,
    lastModified: new Date(row.last_modified),
    createdAt: new Date(row.created_at),
  };
}

function rowToUniversalKnowledge(row: UniversalKnowledgeRow): UniversalKnowledgeRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    qualifiedName: row.qualified_name,
    file: row.file,
    line: row.line,
    knowledge: row.knowledge,
    purposeSummary: row.purpose_summary ?? undefined,
    maintainabilityIndex: row.maintainability_index ?? undefined,
    riskScore: row.risk_score ?? undefined,
    testCoverage: row.test_coverage ?? undefined,
    cyclomaticComplexity: row.cyclomatic_complexity ?? undefined,
    cognitiveComplexity: row.cognitive_complexity ?? undefined,
    embedding: row.embedding
      ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4)
      : undefined,
    confidence: row.confidence,
    generatedAt: row.generated_at,
    validUntil: row.valid_until ?? undefined,
    hash: row.hash,
  };
}

function parseJsonOrNull<T>(raw: string): T | null {
  const parsed = safeJsonParse<T>(raw);
  return parsed.ok ? parsed.value : null;
}

function parseOptionalDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function parseJsonArray<T>(raw: string): T[] {
  const parsed = safeJsonParse<T[]>(raw);
  if (!parsed.ok) {
    // Log warning when JSON parsing fails - silent failures hide data corruption
    console.warn(`[librarian] Failed to parse JSON array from stored data: ${raw.slice(0, 100)}...`);
    return [];
  }
  return Array.isArray(parsed.value) ? parsed.value : [];
}

function parseStringArray(raw: string): string[] {
  return parseJsonArray<unknown>(raw).filter((value): value is string => typeof value === 'string');
}

function stableStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (seen.has(value as object)) {
    throw new Error('Cannot stable-stringify circular structure');
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`);
  return `{${entries.join(',')}}`;
}

function computeContextPackContentHash(pack: ContextPack): string {
  const canonicalPayload = {
    schemaVersion: pack.schemaVersion ?? 1,
    packType: pack.packType,
    targetId: pack.targetId,
    summary: pack.summary,
    keyFacts: [...pack.keyFacts],
    codeSnippets: pack.codeSnippets.map((snippet) => ({
      filePath: normalizeSqlPath(snippet.filePath),
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      content: snippet.content,
      language: snippet.language,
    })),
    relatedFiles: [...pack.relatedFiles].map((filePath) => normalizeSqlPath(filePath)).sort((a, b) => a.localeCompare(b)),
    invalidationTriggers: [...pack.invalidationTriggers].map((filePath) => normalizeSqlPath(filePath)).sort((a, b) => a.localeCompare(b)),
    versionString: pack.version.string,
  };
  return sha256Hex(stableStringify(canonicalPayload));
}

function isIndexingError(value: unknown): value is IndexingError {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    typeof record.error === 'string' &&
    typeof record.recoverable === 'boolean'
  );
}

function isCodeSnippet(value: unknown): value is CodeSnippet {
  if (!value || typeof value !== 'object') return false;
  const snippet = value as Record<string, unknown>;
  return (
    typeof snippet.filePath === 'string' &&
    typeof snippet.startLine === 'number' &&
    typeof snippet.endLine === 'number' &&
    typeof snippet.language === 'string' &&
    typeof snippet.content === 'string'
  );
}

function parseCodeSnippets(raw: string): CodeSnippet[] {
  return parseJsonArray<unknown>(raw).filter(isCodeSnippet);
}

function rowToFunction(row: FunctionRow): FunctionKnowledge {
  return {
    id: row.id,
    filePath: row.file_path,
    name: row.name,
    signature: row.signature,
    purpose: row.purpose,
    startLine: row.start_line,
    endLine: row.end_line,
    isPure: row.is_pure === 1,
    hasSideEffects: row.has_side_effects === 1,
    modifiesParams: row.modifies_params === 1,
    throws: row.throws === 1,
    returnDependsOnInputs: row.return_depends_on_inputs === 1,
    effectSignature: parseStringArray(row.effect_signature),
    confidence: row.confidence,
    accessCount: row.access_count,
    lastAccessed: row.last_accessed ? new Date(row.last_accessed) : null,
    validationCount: row.validation_count,
    outcomeHistory: {
      successes: row.outcome_successes,
      failures: row.outcome_failures,
    },
  };
}

function rowToModule(row: ModuleRow): ModuleKnowledge {
  return {
    id: row.id,
    path: row.path,
    purpose: row.purpose,
    exports: parseStringArray(row.exports),
    dependencies: parseStringArray(row.dependencies),
    confidence: row.confidence,
  };
}

function rowToContextPack(row: ContextPackRow): ContextPack {
  return {
    packId: row.pack_id,
    packType: row.pack_type as ContextPack['packType'],
    targetId: row.target_id,
    schemaVersion: row.schema_version ?? 1,
    contentHash: row.content_hash || undefined,
    summary: row.summary,
    keyFacts: parseStringArray(row.key_facts),
    codeSnippets: parseCodeSnippets(row.code_snippets),
    relatedFiles: parseStringArray(row.related_files),
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    accessCount: row.access_count,
    lastOutcome: row.last_outcome as ContextPack['lastOutcome'],
    successCount: row.success_count ?? 0,
    failureCount: row.failure_count ?? 0,
    version: parseVersionString(row.version_string),
    invalidationTriggers: parseStringArray(row.invalidation_triggers),
  };
}

function rowToIndexingResult(row: IndexingHistoryRow): IndexingResult {
  return {
    taskId: row.id,
    type: row.task_type as IndexingResult['type'],
    startedAt: new Date(row.started_at),
    completedAt: new Date(row.completed_at),
    filesProcessed: row.files_processed,
    filesSkipped: row.files_skipped ?? 0,
    functionsIndexed: row.functions_indexed,
    modulesIndexed: row.modules_indexed,
    contextPacksCreated: row.context_packs_created,
    errors: parseJsonArray<unknown>(row.errors).filter(isIndexingError),
    version: parseVersionString(row.version_string),
  };
}

function rowToBootstrapReport(row: BootstrapHistoryRow): BootstrapReport {
  return {
    workspace: row.workspace,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    phases: parseJsonArray<BootstrapPhaseResult>(row.phases),
    totalFilesProcessed: row.total_files,
    totalFunctionsIndexed: row.total_functions,
    totalContextPacksCreated: row.total_context_packs,
    version: parseVersionString(row.version_string),
    success: row.success === 1,
    error: row.error || undefined,
  };
}

function parseVersionString(versionString: string): LiBrainianVersion {
  const [major, minor, patch] = versionString.split('.').map(Number);
  return {
    major,
    minor,
    patch,
    string: versionString,
    qualityTier: 'full', // FULL tier required - no MVP shortcuts
    indexedAt: new Date(),
    indexerVersion: LIBRARIAN_VERSION.string,
    features: [...LIBRARIAN_VERSION.features],
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a SQLite-backed LiBrainianStorage instance.
 *
 * The storage uses better-sqlite3 for synchronous, high-performance operations.
 * Embeddings are stored as BLOBs with brute-force cosine similarity search
 * (upgradeable to sqlite-vss for vector indexing).
 *
 * @param dbPath - Path to the SQLite database file, or ':memory:' for in-memory storage
 * @param workspaceRoot - Optional workspace root for resolving relative paths
 * @returns A LiBrainianStorage instance (not yet initialized - call initialize())
 *
 * @example
 * ```typescript
 * const storage = createSqliteStorage('./librarian.db', process.cwd());
 * await storage.initialize();
 * ```
 */
export function createSqliteStorage(dbPath: string, workspaceRoot?: string): LiBrainianStorage {
  return new SqliteLiBrainianStorage(dbPath, workspaceRoot);
}

/**
 * Creates and initializes a LiBrainianStorage instance from a StorageBackend configuration.
 *
 * @param backend - Storage backend configuration specifying type and connection details
 * @returns A fully initialized LiBrainianStorage instance
 * @throws Error if the backend type is not supported
 *
 * @example
 * ```typescript
 * const storage = await createStorageFromBackend({
 *   type: 'sqlite',
 *   connectionString: './librarian.db',
 * });
 * ```
 */
export async function createStorageFromBackend(
  backend: StorageBackend
): Promise<LiBrainianStorage> {
  switch (backend.type) {
    case 'sqlite': {
      const storage = new SqliteLiBrainianStorage(
        backend.connectionString || ':memory:'
      );
      await storage.initialize();
      return storage;
    }
    case 'memory': {
      const storage = new SqliteLiBrainianStorage(':memory:');
      await storage.initialize();
      return storage;
    }
    case 'postgres':
      throw new Error('PostgreSQL backend not yet implemented');
    default:
      throw new Error(`Unknown storage backend: ${backend.type}`);
  }
}
