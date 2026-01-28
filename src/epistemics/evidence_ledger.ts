/**
 * @fileoverview Evidence Ledger - Append-Only Epistemic Event Log
 *
 * Implements the IEvidenceLedger interface from the evidence-ledger spec.
 * This is a COMPLEMENTARY system to EvidenceGraphStorage:
 * - EvidenceGraphStorage: Mutable graph of claims, edges, defeaters
 * - EvidenceLedger: Append-only log of ALL epistemic events for audit/calibration
 *
 * Key properties:
 * - APPEND-ONLY: Entries are never modified or deleted
 * - AUDITABLE: Complete trace of how any conclusion was reached
 * - CALIBRATION: Historical data for confidence calibration
 *
 * @packageDocumentation
 */

import type Database from 'better-sqlite3';
import type { ConfidenceValue } from './confidence.js';
import { randomUUID, createHash } from 'node:crypto';
import { assertClaimConfidenceBoundary } from './confidence_guards.js';

// ============================================================================
// BRANDED TYPES
// ============================================================================

export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

export function createEvidenceId(id?: string): EvidenceId {
  return (id ?? `ev_${randomUUID()}`) as EvidenceId;
}

export function createSessionId(id?: string): SessionId {
  return (id ?? `sess_${randomUUID()}`) as SessionId;
}

// ============================================================================
// STABLE ENTRY IDS (WU-LEDG-007)
// ============================================================================

/**
 * Input type for computing evidence hash.
 * Excludes id and timestamp since those are generated, not part of content.
 */
export type EvidenceHashInput = Omit<EvidenceEntry, 'id' | 'timestamp'>;

/**
 * Compute a deterministic SHA-256 hash of evidence entry content.
 *
 * WU-LEDG-007: Content-addressable IDs for reproducibility.
 *
 * The hash is computed from a deterministic JSON serialization of:
 * - kind
 * - payload
 * - provenance
 * - confidence (if present)
 * - relatedEntries
 * - sessionId (if present)
 *
 * @param entry - Evidence entry content (without id and timestamp)
 * @returns SHA-256 hash as lowercase hex string (64 characters)
 */
export function computeEvidenceHash(entry: EvidenceHashInput): string {
  // Create a deterministic representation by sorting object keys
  const canonical = canonicalizeForHash(entry);
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Create a content-addressable evidence ID based on entry content.
 *
 * WU-LEDG-007: Enables cross-session reference of the same evidence.
 *
 * The ID is prefixed with 'ev_hash_' followed by the first 16 characters
 * of the SHA-256 hash, providing a balance between uniqueness and readability.
 *
 * @param entry - Evidence entry content (without id and timestamp)
 * @returns Content-addressable EvidenceId
 */
export function createContentAddressableEvidenceId(entry: EvidenceHashInput): EvidenceId {
  const hash = computeEvidenceHash(entry);
  // Use first 16 chars of hash for reasonable uniqueness while keeping IDs manageable
  return `ev_hash_${hash.slice(0, 16)}` as EvidenceId;
}

/**
 * Create a canonical representation of an object for deterministic hashing.
 * Sorts object keys recursively to ensure consistent serialization.
 */
function canonicalizeForHash(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeForHash);
  }

  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = canonicalizeForHash((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return obj;
}

export const REPLAY_UNAVAILABLE_TRACE = 'unverified_by_trace(replay_unavailable)' as const;

export function isReplayUnavailableTrace(traceId: string): traceId is typeof REPLAY_UNAVAILABLE_TRACE {
  return traceId === REPLAY_UNAVAILABLE_TRACE;
}

export function resolveReplaySessionId(traceId: string | null | undefined): SessionId | null {
  if (!traceId) return null;
  if (traceId.startsWith('unverified_by_trace(')) return null;
  return traceId as SessionId;
}

export function isReplayableTraceId(traceId: string | null | undefined): traceId is SessionId {
  return resolveReplaySessionId(traceId) !== null;
}

// ============================================================================
// EVIDENCE KINDS
// ============================================================================

export type EvidenceKind =
  | 'extraction'
  | 'retrieval'
  | 'synthesis'
  | 'claim'
  | 'verification'
  | 'contradiction'
  | 'feedback'
  | 'outcome'
  | 'tool_call'
  | 'episode'
  | 'calibration';

// ============================================================================
// EVIDENCE RELATIONS
// ============================================================================

/**
 * Types of relationships between evidence entries.
 *
 * - 'supports': This entry provides supporting evidence for the related entry
 * - 'derived_from': This entry was derived from/computed from the related entry
 * - 'contradicts': This entry contradicts the related entry
 * - 'supersedes': This entry supersedes/replaces the related entry (newer version)
 */
export type EvidenceRelationType = 'supports' | 'derived_from' | 'contradicts' | 'supersedes';

/**
 * A typed relationship to another evidence entry.
 */
export interface EvidenceRelation {
  /** The ID of the related evidence entry */
  id: EvidenceId;
  /** The type of relationship */
  type: EvidenceRelationType;
}

// ============================================================================
// PROVENANCE
// ============================================================================

export type ProvenanceSource =
  | 'ast_parser'
  | 'llm_synthesis'
  | 'embedding_search'
  | 'user_input'
  | 'tool_output'
  | 'system_observation';

export interface EvidenceProvenance {
  source: ProvenanceSource;
  method: string;
  agent?: {
    type: 'llm' | 'embedding' | 'ast' | 'human' | 'tool';
    identifier: string;
    version?: string;
  };
  inputHash?: string;
  config?: Record<string, unknown>;
}

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

export interface CodeLocation {
  file: string;
  startLine?: number;
  endLine?: number;
  column?: number;
}

export interface ExtractionEvidence {
  filePath: string;
  extractionType: 'function' | 'class' | 'type' | 'import' | 'export' | 'pattern';
  entity: {
    name: string;
    kind: string;
    signature?: string;
    location: CodeLocation;
  };
  quality: 'ast_verified' | 'ast_inferred' | 'llm_synthesized';
  astNode?: unknown;
}

export interface RetrievalEvidence {
  query: string;
  method: 'vector' | 'keyword' | 'graph' | 'hybrid';
  results: Array<{
    entityId: string;
    score: number;
    snippet: string;
  }>;
  candidatesConsidered: number;
  latencyMs: number;
}

export interface SynthesisEvidence {
  request: string;
  output: string;
  model: {
    provider: string;
    modelId: string;
    temperature?: number;
  };
  tokens: {
    input: number;
    output: number;
  };
  synthesisType: 'answer' | 'explanation' | 'code' | 'summary';
}

export interface ClaimEvidence {
  claim: string;
  category: 'existence' | 'relationship' | 'behavior' | 'quality' | 'recommendation';
  subject: {
    type: 'file' | 'function' | 'class' | 'pattern' | 'system';
    identifier: string;
  };
  supportingEvidence: EvidenceId[];
  knownDefeaters: EvidenceId[];
  confidence: ConfidenceValue;
}

export interface VerificationEvidence {
  claimId: EvidenceId;
  method: 'test' | 'static_analysis' | 'runtime_check' | 'human_review';
  result: 'verified' | 'refuted' | 'inconclusive';
  details: string;
}

export interface ContradictionEvidence {
  claimA: EvidenceId;
  claimB: EvidenceId;
  contradictionType: 'direct' | 'implicational' | 'temporal' | 'scope';
  explanation: string;
  severity: 'blocking' | 'significant' | 'minor';
}

export interface FeedbackEvidence {
  targetId: EvidenceId;
  feedbackType: 'correct' | 'incorrect' | 'helpful' | 'unhelpful' | 'unclear';
  source: 'user' | 'agent' | 'system';
  comment?: string;
}

export interface OutcomeEvidence {
  predictionId: EvidenceId;
  predicted: {
    claim: string;
    confidence: ConfidenceValue;
  };
  actual: {
    outcome: 'correct' | 'incorrect' | 'partial' | 'unknown';
    observation: string;
  };
  verificationMethod: 'user_feedback' | 'test_result' | 'system_observation';
}

export interface ToolCallEvidence {
  toolName: string;
  toolVersion?: string;
  arguments: Record<string, unknown>;
  result: unknown;
  success: boolean;
  durationMs: number;
  errorMessage?: string;
}

export interface EpisodeEvidence {
  query: string;
  stages: Array<{
    name: string;
    durationMs: number;
    success: boolean;
  }>;
  totalDurationMs: number;
  retrievedEntities: number;
  synthesizedResponse: boolean;
}

export interface CalibrationEvidence {
  operationType: string;
  predictions: Array<{
    predicted: number;
    actual: boolean;
  }>;
  ece: number;
  brierScore: number;
  sampleSize: number;
}

export type EvidencePayload =
  | ExtractionEvidence
  | RetrievalEvidence
  | SynthesisEvidence
  | ClaimEvidence
  | VerificationEvidence
  | ContradictionEvidence
  | FeedbackEvidence
  | OutcomeEvidence
  | ToolCallEvidence
  | EpisodeEvidence
  | CalibrationEvidence;

// ============================================================================
// EVIDENCE ENTRY
// ============================================================================

/**
 * An immutable entry in the evidence ledger.
 *
 * INVARIANT: Once created, an entry is never modified
 * INVARIANT: entry.id is globally unique within the ledger
 */
export interface EvidenceEntry {
  id: EvidenceId;
  timestamp: Date;
  kind: EvidenceKind;
  payload: EvidencePayload;
  provenance: EvidenceProvenance;
  confidence?: ConfidenceValue;
  /**
   * Related evidence entries.
   *
   * Can be either:
   * - Legacy format: EvidenceId[] (for backward compatibility)
   * - Typed format: EvidenceRelation[] (preferred, includes relationship type)
   *
   * Use the helper functions `getRelatedIds()` and `getTypedRelations()`
   * to work with these in a type-safe way.
   */
  relatedEntries: EvidenceId[] | EvidenceRelation[];
  sessionId?: SessionId;
}

/**
 * Extract just the IDs from related entries (works with both formats).
 */
export function getRelatedIds(entry: EvidenceEntry): EvidenceId[] {
  if (entry.relatedEntries.length === 0) {
    return [];
  }
  const first = entry.relatedEntries[0];
  if (typeof first === 'string') {
    return entry.relatedEntries as EvidenceId[];
  }
  return (entry.relatedEntries as EvidenceRelation[]).map((r) => r.id);
}

/**
 * Get typed relations from an entry.
 * If the entry uses the legacy format, all relations are assumed to be 'derived_from'.
 */
export function getTypedRelations(entry: EvidenceEntry): EvidenceRelation[] {
  if (entry.relatedEntries.length === 0) {
    return [];
  }
  const first = entry.relatedEntries[0];
  if (typeof first === 'string') {
    // Legacy format - assume derived_from as default relationship
    return (entry.relatedEntries as EvidenceId[]).map((id) => ({
      id,
      type: 'derived_from' as EvidenceRelationType,
    }));
  }
  return entry.relatedEntries as EvidenceRelation[];
}

/**
 * Check if an entry uses typed relations (vs legacy EvidenceId[]).
 */
export function hasTypedRelations(entry: EvidenceEntry): boolean {
  if (entry.relatedEntries.length === 0) {
    return false;
  }
  return typeof entry.relatedEntries[0] !== 'string';
}

/**
 * Filter related entries by relationship type.
 */
export function getRelationsByType(
  entry: EvidenceEntry,
  type: EvidenceRelationType
): EvidenceRelation[] {
  return getTypedRelations(entry).filter((r) => r.type === type);
}

// ============================================================================
// EVIDENCE CHAIN
// ============================================================================

/**
 * Propagation rule for computing chain confidence.
 *
 * WU-THIMPL-108: Configurable confidence propagation rules
 *
 * - 'min': Minimum of all confidences (conservative, default)
 * - 'max': Maximum of all confidences (optimistic)
 * - 'product': Product of all confidences (independent probabilities)
 * - 'weighted_average': Weighted average based on evidence quality
 * - 'noisy_or': 1 - product(1 - ci) (multiple independent causes)
 */
export type PropagationRule = 'min' | 'max' | 'product' | 'weighted_average' | 'noisy_or';

/**
 * Options for computing chain confidence.
 *
 * WU-THIMPL-108: Configurable confidence propagation rules
 */
export interface ChainConfidenceOptions {
  /** The propagation rule to use (default: 'min') */
  propagationRule?: PropagationRule;
  /** Weights for weighted_average rule (keyed by entry ID) */
  weights?: Record<string, number>;
}

export interface EvidenceChain {
  root: EvidenceEntry;
  evidence: EvidenceEntry[];
  graph: Map<EvidenceId, EvidenceId[]>;
  chainConfidence: ConfidenceValue;
  contradictions: ContradictionEvidence[];
}

// ============================================================================
// QUERY INTERFACE
// ============================================================================

export interface EvidenceQuery {
  kinds?: EvidenceKind[];
  timeRange?: {
    from?: Date;
    to?: Date;
  };
  sessionId?: SessionId;
  source?: ProvenanceSource;
  textSearch?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'confidence';
  orderDirection?: 'asc' | 'desc';
}

export interface EvidenceFilter {
  kinds?: EvidenceKind[];
  sessionId?: SessionId;
}

export type Unsubscribe = () => void;

// ============================================================================
// AGENT ATTRIBUTION VALIDATION (WU-THIMPL-109)
// ============================================================================

/**
 * Sources that require agent attribution.
 * WU-THIMPL-109: Required agent attribution for LLM/tool sources
 */
const AGENT_ATTRIBUTION_REQUIRED_SOURCES: ProvenanceSource[] = [
  'llm_synthesis',
  'tool_output',
];

/**
 * Configuration for agent attribution validation.
 * WU-THIMPL-109: Required agent attribution for LLM/tool sources
 */
export interface AgentAttributionConfig {
  /** Whether to enforce agent attribution (default: true) */
  enforceAttribution: boolean;
  /** Whether to throw on missing attribution (default: false = warn only) */
  throwOnMissing: boolean;
}

/**
 * Default configuration for agent attribution validation.
 */
export const DEFAULT_AGENT_ATTRIBUTION_CONFIG: AgentAttributionConfig = {
  enforceAttribution: true,
  throwOnMissing: false,
};

/**
 * Error thrown when agent attribution is missing.
 * WU-THIMPL-109: Required agent attribution for LLM/tool sources
 */
export class MissingAgentAttributionError extends Error {
  constructor(
    public readonly source: ProvenanceSource,
    public readonly context: string
  ) {
    super(`Missing agent attribution for ${source} source. ${context}`);
    this.name = 'MissingAgentAttributionError';
  }
}

/**
 * Warning callback for agent attribution issues.
 */
export type AgentAttributionWarningCallback = (
  source: ProvenanceSource,
  message: string
) => void;

/**
 * Validate that agent attribution is present for sources that require it.
 *
 * WU-THIMPL-109: Required agent attribution for LLM/tool sources
 *
 * @param provenance - The provenance to validate
 * @param config - Configuration for validation behavior
 * @param onWarning - Callback for warnings (when not throwing)
 * @returns true if valid, false if warning was issued
 * @throws MissingAgentAttributionError if throwOnMissing is true and attribution is missing
 */
export function validateAgentAttribution(
  provenance: EvidenceProvenance,
  config: AgentAttributionConfig = DEFAULT_AGENT_ATTRIBUTION_CONFIG,
  onWarning?: AgentAttributionWarningCallback
): boolean {
  if (!config.enforceAttribution) {
    return true;
  }

  if (!AGENT_ATTRIBUTION_REQUIRED_SOURCES.includes(provenance.source)) {
    return true;
  }

  const isValid = provenance.agent !== undefined &&
                  provenance.agent.identifier !== undefined &&
                  provenance.agent.identifier.trim() !== '';

  if (!isValid) {
    const message = `Agent attribution is required for '${provenance.source}' source. ` +
      `Provide provenance.agent with type and identifier.`;

    if (config.throwOnMissing) {
      throw new MissingAgentAttributionError(provenance.source, message);
    }

    if (onWarning) {
      onWarning(provenance.source, message);
    } else {
      // Default warning behavior: console.warn
      console.warn(`[EvidenceLedger] WARNING: ${message}`);
    }
    return false;
  }

  return true;
}

// ============================================================================
// LEDGER INTERFACE
// ============================================================================

/**
 * The Evidence Ledger - append-only storage for all epistemic events.
 *
 * INVARIANT: All append operations are atomic
 * INVARIANT: Query operations are eventually consistent
 * INVARIANT: No entry can be deleted or modified after append
 */
export interface IEvidenceLedger {
  append(entry: Omit<EvidenceEntry, 'id' | 'timestamp'>): Promise<EvidenceEntry>;
  appendBatch(entries: Omit<EvidenceEntry, 'id' | 'timestamp'>[]): Promise<EvidenceEntry[]>;
  query(criteria: EvidenceQuery): Promise<EvidenceEntry[]>;
  get(id: EvidenceId): Promise<EvidenceEntry | null>;
  /**
   * Get the full evidence chain for a claim.
   *
   * WU-THIMPL-108: Now supports configurable propagation rules via options.
   *
   * @param claimId - The claim to build a chain for
   * @param options - Options including propagation rule (default: 'min')
   */
  getChain(claimId: EvidenceId, options?: ChainConfidenceOptions): Promise<EvidenceChain>;
  getSessionEntries(sessionId: SessionId): Promise<EvidenceEntry[]>;
  subscribe(filter: EvidenceFilter, callback: (entry: EvidenceEntry) => void): Unsubscribe;
}

// ============================================================================
// SQLITE IMPLEMENTATION
// ============================================================================

interface LedgerRow {
  id: string;
  timestamp: string;
  kind: string;
  payload: string;
  provenance: string;
  confidence: string | null;
  related_entries: string;
  session_id: string | null;
}

/**
 * SQLite implementation of the evidence ledger.
 *
 * PRECONDITION: Database connection is open and writable
 * POSTCONDITION: All appends are durable (WAL mode)
 * INVARIANT: No data loss on crash
 *
 * WU-THIMPL-109: Includes agent attribution validation for LLM/tool sources
 */
export class SqliteEvidenceLedger implements IEvidenceLedger {
  private db: Database.Database | null = null;
  private initialized = false;
  private subscribers: Map<string, { filter: EvidenceFilter; callback: (entry: EvidenceEntry) => void }> =
    new Map();
  private attributionConfig: AgentAttributionConfig;
  private attributionWarnings: Array<{ source: ProvenanceSource; message: string }> = [];

  constructor(
    private dbPath: string,
    attributionConfig?: Partial<AgentAttributionConfig>
  ) {
    this.attributionConfig = {
      ...DEFAULT_AGENT_ATTRIBUTION_CONFIG,
      ...attributionConfig,
    };
  }

  /**
   * Get warnings issued for missing agent attribution.
   * WU-THIMPL-109: Required agent attribution for LLM/tool sources
   */
  getAttributionWarnings(): ReadonlyArray<{ source: ProvenanceSource; message: string }> {
    return this.attributionWarnings;
  }

  /**
   * Clear attribution warnings.
   * WU-THIMPL-109: Required agent attribution for LLM/tool sources
   */
  clearAttributionWarnings(): void {
    this.attributionWarnings = [];
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const BetterSqlite3 = (await import('better-sqlite3')).default;
    this.db = new BetterSqlite3(this.dbPath);

    // Enable WAL mode for durability and concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');

    this.createTables();
    this.initialized = true;
  }

  private createTables(): void {
    if (!this.db) throw new Error('unverified_by_trace(ledger_not_initialized)');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_ledger (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence TEXT,
        related_entries TEXT NOT NULL DEFAULT '[]',
        session_id TEXT,

        CONSTRAINT valid_kind CHECK (kind IN (
          'extraction', 'retrieval', 'synthesis', 'claim',
          'verification', 'contradiction', 'feedback',
          'outcome', 'tool_call', 'episode', 'calibration'
        ))
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON evidence_ledger(timestamp);
      CREATE INDEX IF NOT EXISTS idx_ledger_kind ON evidence_ledger(kind);
      CREATE INDEX IF NOT EXISTS idx_ledger_session ON evidence_ledger(session_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_kind_timestamp ON evidence_ledger(kind, timestamp);
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    this.subscribers.clear();
  }

  async append(entry: Omit<EvidenceEntry, 'id' | 'timestamp'>): Promise<EvidenceEntry> {
    if (!this.db) throw new Error('unverified_by_trace(ledger_not_initialized)');

    // WU-THIMPL-109: Validate agent attribution for LLM/tool sources
    validateAgentAttribution(
      entry.provenance,
      this.attributionConfig,
      (source, message) => {
        this.attributionWarnings.push({ source, message });
      }
    );

    const id = createEvidenceId();
    const timestamp = new Date();

    const fullEntry: EvidenceEntry = {
      ...entry,
      id,
      timestamp,
    };

    assertClaimConfidenceBoundary(
      { kind: entry.kind, payload: entry.payload, confidence: entry.confidence },
      'evidence_ledger.append'
    );

    this.db
      .prepare(
        `
      INSERT INTO evidence_ledger (id, timestamp, kind, payload, provenance, confidence, related_entries, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        timestamp.toISOString(),
        entry.kind,
        JSON.stringify(entry.payload),
        JSON.stringify(entry.provenance),
        entry.confidence ? JSON.stringify(entry.confidence) : null,
        JSON.stringify(entry.relatedEntries),
        entry.sessionId ?? null
      );

    // Notify subscribers
    this.notifySubscribers(fullEntry);

    return fullEntry;
  }

  async appendBatch(entries: Omit<EvidenceEntry, 'id' | 'timestamp'>[]): Promise<EvidenceEntry[]> {
    if (!this.db) throw new Error('unverified_by_trace(ledger_not_initialized)');

    // WU-THIMPL-109: Validate agent attribution for all entries before starting transaction
    for (const entry of entries) {
      validateAgentAttribution(
        entry.provenance,
        this.attributionConfig,
        (source, message) => {
          this.attributionWarnings.push({ source, message });
        }
      );
    }

    const fullEntries: EvidenceEntry[] = [];
    const timestamp = new Date();

    const stmt = this.db.prepare(`
      INSERT INTO evidence_ledger (id, timestamp, kind, payload, provenance, confidence, related_entries, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((entries: Omit<EvidenceEntry, 'id' | 'timestamp'>[]) => {
      for (const entry of entries) {
        const id = createEvidenceId();
        const fullEntry: EvidenceEntry = { ...entry, id, timestamp };
        fullEntries.push(fullEntry);

        assertClaimConfidenceBoundary(
          { kind: entry.kind, payload: entry.payload, confidence: entry.confidence },
          'evidence_ledger.appendBatch'
        );

        stmt.run(
          id,
          timestamp.toISOString(),
          entry.kind,
          JSON.stringify(entry.payload),
          JSON.stringify(entry.provenance),
          entry.confidence ? JSON.stringify(entry.confidence) : null,
          JSON.stringify(entry.relatedEntries),
          entry.sessionId ?? null
        );
      }
    });

    insertMany(entries);

    // Notify subscribers for each entry
    for (const entry of fullEntries) {
      this.notifySubscribers(entry);
    }

    return fullEntries;
  }

  async query(criteria: EvidenceQuery): Promise<EvidenceEntry[]> {
    if (!this.db) throw new Error('unverified_by_trace(ledger_not_initialized)');

    let sql = 'SELECT * FROM evidence_ledger WHERE 1=1';
    const params: unknown[] = [];

    if (criteria.kinds && criteria.kinds.length > 0) {
      sql += ` AND kind IN (${criteria.kinds.map(() => '?').join(', ')})`;
      params.push(...criteria.kinds);
    }

    if (criteria.timeRange?.from) {
      sql += ' AND timestamp >= ?';
      params.push(criteria.timeRange.from.toISOString());
    }

    if (criteria.timeRange?.to) {
      sql += ' AND timestamp <= ?';
      params.push(criteria.timeRange.to.toISOString());
    }

    if (criteria.sessionId) {
      sql += ' AND session_id = ?';
      params.push(criteria.sessionId);
    }

    if (criteria.source) {
      sql += " AND json_extract(provenance, '$.source') = ?";
      params.push(criteria.source);
    }

    if (criteria.textSearch) {
      sql += ' AND payload LIKE ?';
      params.push(`%${criteria.textSearch}%`);
    }

    const orderBy = criteria.orderBy ?? 'timestamp';
    const orderDir = criteria.orderDirection ?? 'desc';
    sql += ` ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;

    // SQLite requires LIMIT when using OFFSET, so we need to handle this
    if (criteria.limit || criteria.offset) {
      // Use provided limit or a very large number if only offset is specified
      const effectiveLimit = criteria.limit ?? -1; // SQLite: -1 means no limit
      sql += ' LIMIT ?';
      params.push(effectiveLimit);

      if (criteria.offset) {
        sql += ' OFFSET ?';
        params.push(criteria.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as LedgerRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  async get(id: EvidenceId): Promise<EvidenceEntry | null> {
    if (!this.db) throw new Error('unverified_by_trace(ledger_not_initialized)');

    const row = this.db.prepare('SELECT * FROM evidence_ledger WHERE id = ?').get(id) as
      | LedgerRow
      | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  async getChain(claimId: EvidenceId, options?: ChainConfidenceOptions): Promise<EvidenceChain> {
    const root = await this.get(claimId);
    if (!root) {
      throw new Error(`unverified_by_trace(claim_not_found): ${claimId}`);
    }

    const visited = new Set<string>();
    const entriesById = new Map<EvidenceId, EvidenceEntry>();
    const graph = new Map<EvidenceId, EvidenceId[]>();
    const contradictions: ContradictionEvidence[] = [];

    // Phase 1: BFS to collect all related evidence entries and build the graph
    const queue: EvidenceId[] = [claimId];
    visited.add(claimId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const entry = currentId === claimId ? root : await this.get(currentId);
      if (!entry) continue;

      entriesById.set(currentId, entry);
      // Use getRelatedIds to handle both legacy and typed relation formats
      const relatedIds = getRelatedIds(entry);
      graph.set(currentId, relatedIds);

      // Check for contradictions
      if (entry.kind === 'contradiction') {
        contradictions.push(entry.payload as ContradictionEvidence);
      }

      for (const relatedId of relatedIds) {
        if (!visited.has(relatedId)) {
          visited.add(relatedId);
          queue.push(relatedId);
        }
      }
    }

    // Phase 2: Topological sort so dependencies come before dependents (WU-THIMPL-204)
    // The graph edges are entry -> relatedEntries (dependencies)
    // We want dependencies first, so we do a reverse topological sort
    const evidence = this.topologicalSort(entriesById, graph);

    // Compute chain confidence using specified propagation rule (default: min)
    // Reduce confidence when blocking contradictions are present
    const chainConfidence = this.computeChainConfidence(evidence, contradictions, options);

    return {
      root,
      evidence,
      graph,
      chainConfidence,
      contradictions,
    };
  }

  /**
   * Perform topological sort on evidence entries.
   *
   * WU-THIMPL-204: Orders entries so dependencies come before dependents.
   *
   * Uses Kahn's algorithm (BFS-based topological sort):
   * 1. Build reverse graph (dependent -> dependency becomes dependency -> [dependents])
   * 2. Find all nodes with no incoming edges (leaf dependencies)
   * 3. Process those first, removing them from the graph
   * 4. Repeat until all nodes are processed
   *
   * For cyclic graphs, remaining nodes are appended at the end.
   *
   * @param entriesById - Map of entry ID to entry
   * @param graph - Map of entry ID to its dependencies (relatedIds)
   * @returns Entries sorted so dependencies come before dependents
   */
  private topologicalSort(
    entriesById: Map<EvidenceId, EvidenceEntry>,
    graph: Map<EvidenceId, EvidenceId[]>
  ): EvidenceEntry[] {
    const allIds = new Set(entriesById.keys());

    // Build in-degree count: how many entries depend on each entry
    // An entry's "in-degree" in the reversed sense is how many other entries
    // list it as a dependency
    const inDegree = new Map<EvidenceId, number>();
    const reverseDeps = new Map<EvidenceId, Set<EvidenceId>>();

    // Initialize
    for (const id of allIds) {
      inDegree.set(id, 0);
      reverseDeps.set(id, new Set());
    }

    // Build reverse dependency graph
    // If A has related entries [B, C], then A depends on B and C
    // In reverse: B has dependent A, C has dependent A
    for (const [entryId, dependencies] of graph) {
      for (const depId of dependencies) {
        if (allIds.has(depId)) {
          reverseDeps.get(depId)!.add(entryId);
          // Entry A depends on depId, so entryId has one more incoming edge in forward graph
          inDegree.set(entryId, (inDegree.get(entryId) ?? 0) + 1);
        }
      }
    }

    // Find all entries with no dependencies (in-degree 0 in forward graph)
    // These are the leaf nodes that should come first
    const readyQueue: EvidenceId[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        readyQueue.push(id);
      }
    }

    // Process entries in topological order
    const sorted: EvidenceEntry[] = [];
    const processed = new Set<EvidenceId>();

    while (readyQueue.length > 0) {
      const currentId = readyQueue.shift()!;
      const entry = entriesById.get(currentId);
      if (entry && !processed.has(currentId)) {
        sorted.push(entry);
        processed.add(currentId);

        // For each entry that depends on currentId, decrease its in-degree
        const dependents = reverseDeps.get(currentId) ?? new Set();
        for (const dependentId of dependents) {
          const newDegree = (inDegree.get(dependentId) ?? 1) - 1;
          inDegree.set(dependentId, newDegree);
          if (newDegree === 0 && !processed.has(dependentId)) {
            readyQueue.push(dependentId);
          }
        }
      }
    }

    // Handle any remaining entries (in case of cycles)
    // Add them at the end to ensure all entries are included
    for (const [id, entry] of entriesById) {
      if (!processed.has(id)) {
        sorted.push(entry);
      }
    }

    return sorted;
  }

  /**
   * Compute the overall confidence for an evidence chain.
   *
   * Supports configurable propagation rules (WU-THIMPL-108):
   * - 'min': Minimum of all confidences (conservative, default)
   * - 'max': Maximum of all confidences (optimistic)
   * - 'product': Product of all confidences (independent probabilities)
   * - 'weighted_average': Weighted average based on evidence quality
   * - 'noisy_or': 1 - product(1 - ci) (multiple independent causes)
   *
   * Confidence is reduced by a penalty factor when contradictions are present.
   *
   * @param entries - All evidence entries in the chain
   * @param contradictions - Contradictions found in the chain (optional)
   * @param options - Options including propagation rule (optional)
   * @returns The computed confidence value for the entire chain
   */
  private computeChainConfidence(
    entries: EvidenceEntry[],
    contradictions: ContradictionEvidence[] = [],
    options?: ChainConfidenceOptions
  ): ConfidenceValue {
    const rule = options?.propagationRule ?? 'min';
    const weights = options?.weights ?? {};

    const entriesWithConfidence = entries.filter((e) => e.confidence);
    const confidences = entriesWithConfidence.map((e) => e.confidence!);

    if (confidences.length === 0) {
      return { type: 'absent', reason: 'insufficient_data' };
    }

    // If any confidence is absent, chain is absent
    if (confidences.some((c) => c.type === 'absent')) {
      return { type: 'absent', reason: 'uncalibrated' };
    }

    // Extract numeric values from confidences
    const valuesWithIds = entriesWithConfidence.map((e) => {
      const c = e.confidence!;
      let value: number;
      switch (c.type) {
        case 'deterministic':
        case 'derived':
        case 'measured':
          value = c.value;
          break;
        case 'bounded':
          value = c.low;
          break;
        default:
          value = 0;
      }
      return { id: e.id, value };
    });

    const values = valuesWithIds.map((v) => v.value);

    // Apply propagation rule
    let aggregatedValue: number;
    let formulaBase: string;

    switch (rule) {
      case 'min':
        aggregatedValue = Math.min(...values);
        formulaBase = 'min(chain_entries)';
        break;

      case 'max':
        aggregatedValue = Math.max(...values);
        formulaBase = 'max(chain_entries)';
        break;

      case 'product':
        aggregatedValue = values.reduce((acc, v) => acc * v, 1);
        formulaBase = 'product(chain_entries)';
        break;

      case 'weighted_average': {
        let weightedSum = 0;
        let totalWeight = 0;
        for (const { id, value } of valuesWithIds) {
          const weight = weights[id] ?? 1;
          weightedSum += value * weight;
          totalWeight += weight;
        }
        aggregatedValue = totalWeight > 0 ? weightedSum / totalWeight : 0;
        formulaBase = 'weighted_average(chain_entries)';
        break;
      }

      case 'noisy_or':
        // P(at least one) = 1 - P(none) = 1 - product(1 - ci)
        aggregatedValue = 1 - values.reduce((acc, v) => acc * (1 - v), 1);
        formulaBase = 'noisy_or(chain_entries)';
        break;

      default:
        // Default to min for unknown rules
        aggregatedValue = Math.min(...values);
        formulaBase = 'min(chain_entries)';
    }

    // Apply contradiction penalty: reduce confidence when contradictions exist
    // Blocking contradictions completely invalidate the chain
    // Significant contradictions reduce confidence substantially
    // Minor contradictions have smaller impact
    const blockingCount = contradictions.filter((c) => c.severity === 'blocking').length;
    const significantCount = contradictions.filter((c) => c.severity === 'significant').length;
    const minorCount = contradictions.filter((c) => c.severity === 'minor').length;

    if (blockingCount > 0) {
      // Blocking contradictions make the chain unreliable
      // Set to 0 to indicate the chain cannot be trusted
      aggregatedValue = 0;
    } else if (significantCount > 0) {
      // Significant contradictions reduce confidence by 50% per contradiction
      // but floor at 0.1 to indicate some evidence exists
      const penalty = Math.pow(0.5, significantCount);
      aggregatedValue = Math.max(0.1, aggregatedValue * penalty);
    } else if (minorCount > 0) {
      // Minor contradictions reduce confidence by 10% per contradiction
      const penalty = Math.pow(0.9, minorCount);
      aggregatedValue = aggregatedValue * penalty;
    }

    const formula =
      contradictions.length > 0
        ? `${formulaBase} * contradiction_penalty(blocking=${blockingCount}, significant=${significantCount}, minor=${minorCount})`
        : formulaBase;

    return {
      type: 'derived',
      value: aggregatedValue,
      formula,
      inputs: entriesWithConfidence.map((e) => ({
        name: e.id,
        confidence: e.confidence!,
      })),
    };
  }

  async getSessionEntries(sessionId: SessionId): Promise<EvidenceEntry[]> {
    return this.query({ sessionId, orderBy: 'timestamp', orderDirection: 'asc' });
  }

  subscribe(filter: EvidenceFilter, callback: (entry: EvidenceEntry) => void): Unsubscribe {
    const id = `sub_${randomUUID()}`;
    this.subscribers.set(id, { filter, callback });

    return () => {
      this.subscribers.delete(id);
    };
  }

  private notifySubscribers(entry: EvidenceEntry): void {
    for (const { filter, callback } of this.subscribers.values()) {
      // Check if entry matches filter
      if (filter.kinds && !filter.kinds.includes(entry.kind)) continue;
      if (filter.sessionId && entry.sessionId !== filter.sessionId) continue;

      try {
        callback(entry);
      } catch {
        // Subscriber errors should not break the ledger
      }
    }
  }

  private rowToEntry(row: LedgerRow): EvidenceEntry {
    // Parse related_entries - handles both legacy (EvidenceId[]) and typed (EvidenceRelation[]) formats
    const parsedRelations = JSON.parse(row.related_entries);
    // The JSON will preserve the format - if it's an array of strings, it's legacy format
    // If it's an array of objects with id/type, it's the new typed format
    const relatedEntries: EvidenceId[] | EvidenceRelation[] = parsedRelations;

    return {
      id: row.id as EvidenceId,
      timestamp: new Date(row.timestamp),
      kind: row.kind as EvidenceKind,
      payload: JSON.parse(row.payload) as EvidencePayload,
      provenance: JSON.parse(row.provenance) as EvidenceProvenance,
      confidence: row.confidence ? (JSON.parse(row.confidence) as ConfidenceValue) : undefined,
      relatedEntries,
      sessionId: row.session_id ? (row.session_id as SessionId) : undefined,
    };
  }
}

// ============================================================================
// REPLAY SESSION (WU-LEDG-006)
// ============================================================================

/**
 * Result of verifying replay integrity.
 *
 * WU-LEDG-006: Deterministic replay verification.
 */
export interface ReplayIntegrityResult {
  /** Whether all entries with inputHash passed verification */
  valid: boolean;
  /** Total number of entries in the session */
  entriesVerified: number;
  /** Number of entries that have inputHash for verification */
  entriesWithHash: number;
  /** Number of entries that failed hash verification */
  hashMismatches: number;
  /** Details of any hash mismatches */
  mismatches: Array<{
    entryId: EvidenceId;
    expectedHash?: string;
    reason: string;
  }>;
}

/**
 * Replay session for deterministic reconstruction of epistemic events.
 *
 * WU-LEDG-006: Enables audit trail reconstruction and verification.
 *
 * INVARIANT: Entries are immutable once loaded
 * INVARIANT: Order is preserved from original session execution
 */
export class ReplaySession {
  /** The session ID being replayed */
  readonly sessionId: SessionId;
  /** All entries from the session */
  readonly entries: ReadonlyArray<EvidenceEntry>;

  private constructor(sessionId: SessionId, entries: EvidenceEntry[]) {
    this.sessionId = sessionId;
    // Sort by timestamp to ensure execution order
    this.entries = [...entries].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  /**
   * Reconstruct a replay session from stored evidence.
   *
   * @param ledger - The evidence ledger to query
   * @param sessionId - The session to replay
   * @returns ReplaySession with all entries from the session
   */
  static async fromSessionId(
    ledger: IEvidenceLedger,
    sessionId: SessionId
  ): Promise<ReplaySession> {
    const entries = await ledger.getSessionEntries(sessionId);
    return new ReplaySession(sessionId, entries);
  }

  /**
   * Get entries in their original execution order.
   *
   * Entries are ordered by timestamp, which represents the order
   * in which they were appended to the ledger during the session.
   *
   * @returns Entries sorted by timestamp ascending
   */
  getOrderedEntries(): EvidenceEntry[] {
    return [...this.entries];
  }

  /**
   * Verify the integrity of the replay session.
   *
   * Checks that entries with inputHash in their provenance are consistent.
   * This enables verification that replay would produce the same results.
   *
   * @returns Verification result with details of any mismatches
   */
  verifyIntegrity(): ReplayIntegrityResult {
    const mismatches: ReplayIntegrityResult['mismatches'] = [];
    let entriesWithHash = 0;

    for (const entry of this.entries) {
      if (entry.provenance.inputHash) {
        entriesWithHash++;
        // The inputHash is stored as-is; in a full replay scenario,
        // we would re-compute the hash of inputs and compare.
        // For now, we verify that the hash is present and non-empty.
        if (!entry.provenance.inputHash.trim()) {
          mismatches.push({
            entryId: entry.id,
            expectedHash: entry.provenance.inputHash,
            reason: 'Empty inputHash value',
          });
        }
      }
    }

    return {
      valid: mismatches.length === 0,
      entriesVerified: this.entries.length,
      entriesWithHash,
      hashMismatches: mismatches.length,
      mismatches,
    };
  }

  /**
   * Get entries filtered by kind.
   *
   * @param kinds - Kinds to include
   * @returns Filtered entries in execution order
   */
  getEntriesByKind(kinds: EvidenceKind[]): EvidenceEntry[] {
    return this.entries.filter((e) => kinds.includes(e.kind));
  }

  /**
   * Get the first entry in the session.
   *
   * @returns The first entry or undefined if session is empty
   */
  getFirstEntry(): EvidenceEntry | undefined {
    return this.entries[0];
  }

  /**
   * Get the last entry in the session.
   *
   * @returns The last entry or undefined if session is empty
   */
  getLastEntry(): EvidenceEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Get the duration of the session in milliseconds.
   *
   * @returns Duration from first to last entry, or 0 if fewer than 2 entries
   */
  getDurationMs(): number {
    if (this.entries.length < 2) return 0;
    const first = this.entries[0];
    const last = this.entries[this.entries.length - 1];
    return last.timestamp.getTime() - first.timestamp.getTime();
  }
}

// ============================================================================
// DETERMINISTIC REPLAY MODE (WU-THIMPL-205)
// ============================================================================

/**
 * Options for deterministic replay.
 *
 * WU-THIMPL-205: True deterministic replay with verification.
 */
export interface ReplayOptions {
  /**
   * Whether to verify content hashes during replay.
   * When true, the executor's output hash is compared against recorded hash.
   */
  verifyHashes: boolean;

  /**
   * Whether to stop replay on first hash mismatch.
   * When false, continues replay but records all mismatches.
   */
  stopOnMismatch: boolean;

  /**
   * Whether to record new evidence generated during replay.
   * When true, executor results are appended to a new session.
   * When false, replay is dry-run only.
   */
  recordNewEvidence: boolean;

  /**
   * Optional new session ID for recording replay results.
   * Required when recordNewEvidence is true.
   */
  replaySessionId?: SessionId;

  /**
   * Optional callback for progress reporting.
   * Called after each entry is processed.
   */
  onProgress?: (progress: ReplayProgress) => void;
}

/**
 * Progress information during replay.
 */
export interface ReplayProgress {
  /** Current entry index (0-based) */
  currentIndex: number;
  /** Total number of entries */
  totalEntries: number;
  /** ID of the entry being processed */
  entryId: EvidenceId;
  /** Whether the current entry matched */
  matched: boolean;
  /** Time elapsed in milliseconds */
  elapsedMs: number;
}

/**
 * Result of a single entry replay.
 */
export interface ReplayEntryResult {
  /** The original entry that was replayed */
  originalEntry: EvidenceEntry;
  /** The result from the executor */
  executorResult: unknown;
  /** Whether the hash matched (null if no hash to verify) */
  hashMatched: boolean | null;
  /** Expected hash (from original entry) */
  expectedHash: string | null;
  /** Actual hash (from executor result) */
  actualHash: string | null;
  /** New entry ID if recorded */
  newEntryId?: EvidenceId;
  /** Error if executor threw */
  error?: Error;
}

/**
 * Result of replaying a full session.
 *
 * WU-THIMPL-205: Comprehensive replay result with verification details.
 */
export interface ReplayResult {
  /** Whether replay completed successfully */
  success: boolean;
  /** Session that was replayed */
  sessionId: SessionId;
  /** New session ID if evidence was recorded */
  replaySessionId?: SessionId;
  /** Total entries processed */
  entriesProcessed: number;
  /** Number of hash matches (entries that produced same output) */
  hashMatches: number;
  /** Number of hash mismatches */
  hashMismatches: number;
  /** Number of entries without hashes (could not verify) */
  entriesWithoutHash: number;
  /** Number of entries where executor threw */
  executorErrors: number;
  /** Total replay duration in milliseconds */
  durationMs: number;
  /** Results for each entry */
  entryResults: ReplayEntryResult[];
  /** Summary of mismatches for debugging */
  mismatchSummary: Array<{
    entryId: EvidenceId;
    kind: EvidenceKind;
    expectedHash: string;
    actualHash: string;
  }>;
}

/**
 * Default replay options.
 */
export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  verifyHashes: true,
  stopOnMismatch: false,
  recordNewEvidence: false,
};

/**
 * Replay a session with deterministic verification.
 *
 * WU-THIMPL-205: True deterministic replay mode.
 *
 * ## Overview
 *
 * This function replays a recorded session by executing each entry through
 * a user-provided executor function. It verifies that the executor produces
 * the same outputs (via hash comparison) as the original session.
 *
 * ## Use Cases
 *
 * 1. **Regression Testing**: Verify that code changes don't affect outputs
 * 2. **Debugging**: Reproduce exact sequence of operations
 * 3. **Audit**: Verify that recorded evidence is reproducible
 * 4. **Migration**: Re-run operations with new configuration
 *
 * ## Hash Verification
 *
 * For entries with `provenance.inputHash`, the replay verifies that:
 * - The executor receives the same inputs (via entry payload)
 * - The executor produces the same output hash
 *
 * Entries without hashes are executed but cannot be verified.
 *
 * ## Example
 *
 * ```typescript
 * const session = await ReplaySession.fromSessionId(ledger, sessionId);
 *
 * const result = await replaySession(session, async (entry) => {
 *   // Re-execute the operation
 *   if (entry.kind === 'extraction') {
 *     const payload = entry.payload as ExtractionEvidence;
 *     return await parser.extractFromFile(payload.filePath);
 *   }
 *   // ... handle other kinds
 * }, {
 *   verifyHashes: true,
 *   stopOnMismatch: false,
 *   recordNewEvidence: false,
 * });
 *
 * console.log(`Replay ${result.success ? 'succeeded' : 'failed'}`);
 * console.log(`Matches: ${result.hashMatches}/${result.entriesProcessed}`);
 * ```
 *
 * @param session - The replay session containing entries to replay
 * @param executor - Function that re-executes each entry and returns result
 * @param options - Replay options
 * @param ledger - Evidence ledger (required if recordNewEvidence is true)
 * @returns Comprehensive replay result
 */
export async function replaySession(
  session: ReplaySession,
  executor: (entry: EvidenceEntry) => Promise<unknown>,
  options?: Partial<ReplayOptions>,
  ledger?: IEvidenceLedger
): Promise<ReplayResult> {
  const opts: ReplayOptions = { ...DEFAULT_REPLAY_OPTIONS, ...options };
  const startTime = Date.now();

  // Validate options
  if (opts.recordNewEvidence && !ledger) {
    throw new Error('ledger is required when recordNewEvidence is true');
  }
  if (opts.recordNewEvidence && !opts.replaySessionId) {
    opts.replaySessionId = createSessionId(`replay_${session.sessionId}_${Date.now()}`);
  }

  const result: ReplayResult = {
    success: true,
    sessionId: session.sessionId,
    replaySessionId: opts.replaySessionId,
    entriesProcessed: 0,
    hashMatches: 0,
    hashMismatches: 0,
    entriesWithoutHash: 0,
    executorErrors: 0,
    durationMs: 0,
    entryResults: [],
    mismatchSummary: [],
  };

  const entries = session.getOrderedEntries();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryResult: ReplayEntryResult = {
      originalEntry: entry,
      executorResult: undefined,
      hashMatched: null,
      expectedHash: entry.provenance.inputHash ?? null,
      actualHash: null,
    };

    try {
      // Execute the entry
      entryResult.executorResult = await executor(entry);

      // Compute hash of result for verification
      if (opts.verifyHashes && entry.provenance.inputHash) {
        const actualHash = computeResultHash(entryResult.executorResult);
        entryResult.actualHash = actualHash;

        // Compare hashes
        // Note: We compare result hashes, not input hashes
        // The inputHash in provenance represents the input that produced this output
        // For true determinism, same input should produce same output
        // So we verify output consistency
        if (actualHash === entry.provenance.inputHash) {
          entryResult.hashMatched = true;
          result.hashMatches++;
        } else {
          entryResult.hashMatched = false;
          result.hashMismatches++;
          result.mismatchSummary.push({
            entryId: entry.id,
            kind: entry.kind,
            expectedHash: entry.provenance.inputHash,
            actualHash,
          });

          if (opts.stopOnMismatch) {
            result.success = false;
            result.entryResults.push(entryResult);
            result.entriesProcessed = i + 1;
            result.durationMs = Date.now() - startTime;
            return result;
          }
        }
      } else {
        result.entriesWithoutHash++;
      }

      // Record new evidence if requested
      if (opts.recordNewEvidence && ledger) {
        const newEntry = await ledger.append({
          kind: entry.kind,
          payload: entry.payload,
          provenance: {
            ...entry.provenance,
            inputHash: entryResult.actualHash ?? entry.provenance.inputHash,
          },
          relatedEntries: entry.relatedEntries,
          sessionId: opts.replaySessionId,
          confidence: entry.confidence,
        });
        entryResult.newEntryId = newEntry.id;
      }
    } catch (error) {
      entryResult.error = error instanceof Error ? error : new Error(String(error));
      result.executorErrors++;

      if (opts.stopOnMismatch) {
        result.success = false;
        result.entryResults.push(entryResult);
        result.entriesProcessed = i + 1;
        result.durationMs = Date.now() - startTime;
        return result;
      }
    }

    result.entryResults.push(entryResult);
    result.entriesProcessed = i + 1;

    // Report progress if callback provided
    if (opts.onProgress) {
      opts.onProgress({
        currentIndex: i,
        totalEntries: entries.length,
        entryId: entry.id,
        matched: entryResult.hashMatched ?? true,
        elapsedMs: Date.now() - startTime,
      });
    }
  }

  result.durationMs = Date.now() - startTime;
  result.success = result.hashMismatches === 0 && result.executorErrors === 0;

  return result;
}

/**
 * Compute a hash of an executor result for verification.
 *
 * Uses SHA-256 to produce a deterministic hash of the result.
 *
 * @param result - The executor result to hash
 * @returns SHA-256 hex hash of the result
 */
function computeResultHash(result: unknown): string {
  // Use the existing computeEvidenceHash infrastructure
  // Serialize result to JSON for consistent hashing
  const serialized = JSON.stringify(result, Object.keys(result as object).sort());
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createEvidenceLedger(dbPath: string): SqliteEvidenceLedger {
  return new SqliteEvidenceLedger(dbPath);
}
