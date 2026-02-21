/**
 * @fileoverview Evidence Graph Storage Layer
 *
 * Implements SQLite storage for the evidence graph:
 * - Claims (knowledge propositions)
 * - Evidence edges (supports, opposes, defeats)
 * - Defeaters (staleness, contradictions, etc.)
 * - Contradictions (never silently reconciled)
 *
 * Design principles:
 * - Backward compatible with existing confidence fields
 * - Graph queries under 100ms for 10K nodes
 * - ACID transactions for graph consistency
 *
 * @packageDocumentation
 */

import type Database from 'better-sqlite3';
import {
  type Claim,
  type ClaimId,
  type EvidenceEdge,
  type ExtendedDefeater,
  type Contradiction,
  type EvidenceGraph,
  type SerializedEvidenceGraph,
  type ClaimSignalStrength,
  createClaimId,
  createEmptyEvidenceGraph,
  serializeEvidenceGraph,
  deserializeEvidenceGraph,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
} from './types.js';
import { absent } from './confidence.js';

// ============================================================================
// TYPES
// ============================================================================

/** Options for claim queries */
export interface ClaimQueryOptions {
  /** Filter by claim type */
  type?: string;
  /** Filter by status */
  status?: string;
  /** Filter by subject type */
  subjectType?: string;
  /** Filter by subject ID */
  subjectId?: string;
  /** Minimum signal-strength threshold */
  minSignalStrength?: number;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order by field */
  orderBy?: 'createdAt' | 'signalStrength' | 'status';
  /** Order direction */
  orderDir?: 'ASC' | 'DESC';
}

/** Options for edge queries */
export interface EdgeQueryOptions {
  /** Filter by source claim */
  fromClaimId?: ClaimId;
  /** Filter by target claim */
  toClaimId?: ClaimId;
  /** Filter by edge type */
  type?: string;
  /** Minimum strength threshold */
  minStrength?: number;
  /** Maximum results */
  limit?: number;
}

/** Options for defeater queries */
export interface DefeaterQueryOptions {
  /** Filter by defeater type */
  type?: string;
  /** Filter by status */
  status?: string;
  /** Filter by severity */
  severity?: string;
  /** Filter by affected claim */
  affectedClaimId?: ClaimId;
  /** Maximum results */
  limit?: number;
}

/** Options for contradiction queries */
export interface ContradictionQueryOptions {
  /** Filter by status */
  status?: string;
  /** Filter by severity */
  severity?: string;
  /** Filter by claim involved */
  claimId?: ClaimId;
  /** Maximum results */
  limit?: number;
}

/** Graph traversal result */
export interface TraversalResult {
  /** Claims reached */
  claims: Claim[];
  /** Edges traversed */
  edges: EvidenceEdge[];
  /** Depth reached */
  maxDepth: number;
}

// ============================================================================
// STORAGE INTERFACE
// ============================================================================

/**
 * Evidence graph storage interface.
 * Extends the base librainian storage with graph operations.
 */
export interface EvidenceGraphStorage {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  isInitialized(): boolean;

  // Claims
  getClaim(id: ClaimId): Promise<Claim | null>;
  getClaims(options?: ClaimQueryOptions): Promise<Claim[]>;
  getClaimsBySubject(subjectId: string): Promise<Claim[]>;
  upsertClaim(claim: Claim): Promise<void>;
  upsertClaims(claims: Claim[]): Promise<void>;
  deleteClaim(id: ClaimId): Promise<void>;
  updateClaimStatus(id: ClaimId, status: Claim['status']): Promise<void>;
  updateClaimSignalStrength(id: ClaimId, signalStrength: ClaimSignalStrength): Promise<void>;

  // Edges
  getEdge(id: string): Promise<EvidenceEdge | null>;
  getEdges(options?: EdgeQueryOptions): Promise<EvidenceEdge[]>;
  getEdgesFrom(claimId: ClaimId): Promise<EvidenceEdge[]>;
  getEdgesTo(claimId: ClaimId): Promise<EvidenceEdge[]>;
  upsertEdge(edge: EvidenceEdge): Promise<void>;
  upsertEdges(edges: EvidenceEdge[]): Promise<void>;
  deleteEdge(id: string): Promise<void>;
  deleteEdgesForClaim(claimId: ClaimId): Promise<void>;

  // Defeaters
  getDefeater(id: string): Promise<ExtendedDefeater | null>;
  getDefeaters(options?: DefeaterQueryOptions): Promise<ExtendedDefeater[]>;
  getActiveDefeaters(): Promise<ExtendedDefeater[]>;
  getDefeatersForClaim(claimId: ClaimId): Promise<ExtendedDefeater[]>;
  upsertDefeater(defeater: ExtendedDefeater): Promise<void>;
  upsertDefeaters(defeaters: ExtendedDefeater[]): Promise<void>;
  deleteDefeater(id: string): Promise<void>;
  activateDefeater(id: string): Promise<void>;
  resolveDefeater(id: string): Promise<void>;

  // Contradictions
  getContradiction(id: string): Promise<Contradiction | null>;
  getContradictions(options?: ContradictionQueryOptions): Promise<Contradiction[]>;
  getUnresolvedContradictions(): Promise<Contradiction[]>;
  getContradictionsForClaim(claimId: ClaimId): Promise<Contradiction[]>;
  upsertContradiction(contradiction: Contradiction): Promise<void>;
  deleteContradiction(id: string): Promise<void>;
  resolveContradiction(id: string, resolution: Contradiction['resolution']): Promise<void>;

  // Graph operations
  getFullGraph(workspace: string): Promise<EvidenceGraph>;
  saveFullGraph(graph: EvidenceGraph): Promise<void>;
  traverseFrom(claimId: ClaimId, maxDepth: number): Promise<TraversalResult>;
  findPath(fromClaimId: ClaimId, toClaimId: ClaimId): Promise<EvidenceEdge[]>;

  // Statistics
  getGraphStats(): Promise<GraphStats>;
}

/** Graph statistics */
export interface GraphStats {
  claimCount: number;
  edgeCount: number;
  activeDefeaterCount: number;
  unresolvedContradictionCount: number;
  avgSignalStrength: number;
  staleClaims: number;
}

// ============================================================================
// SQLITE IMPLEMENTATION
// ============================================================================

/**
 * SQLite implementation of evidence graph storage.
 */
export class SqliteEvidenceGraphStorage implements EvidenceGraphStorage {
  private db: Database.Database | null = null;
  private initialized = false;
  private workspace: string;

  constructor(private dbPath: string, workspace: string) {
    this.workspace = workspace;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import to avoid bundling issues
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    this.db = new BetterSqlite3(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Create tables
    this.ensureEvidenceGraphTables();

    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureEvidenceGraphTables(): void {
    if (!this.db) return;

    // Claims table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_claims (
        id TEXT PRIMARY KEY,
        proposition TEXT NOT NULL,
        type TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        subject_location TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version TEXT,
        source_trace_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        confidence_json TEXT,
        confidence_overall REAL NOT NULL DEFAULT 0.5,
        confidence_retrieval REAL NOT NULL DEFAULT 0.5,
        confidence_structural REAL NOT NULL DEFAULT 0.5,
        confidence_semantic REAL NOT NULL DEFAULT 0.5,
        confidence_test_execution REAL NOT NULL DEFAULT 0.5,
        confidence_recency REAL NOT NULL DEFAULT 0.5,
        confidence_aggregation_method TEXT NOT NULL DEFAULT 'geometric_mean',
        schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_claims_type ON evidence_claims(type);
      CREATE INDEX IF NOT EXISTS idx_claims_status ON evidence_claims(status);
      CREATE INDEX IF NOT EXISTS idx_claims_subject ON evidence_claims(subject_type, subject_id);
      CREATE INDEX IF NOT EXISTS idx_claims_confidence ON evidence_claims(confidence_overall);
    `);

    // Ensure new confidence_json column exists for ConfidenceValue storage.
    const claimColumns = this.db
      .prepare('PRAGMA table_info(evidence_claims)')
      .all() as Array<{ name: string }>;
    const hasConfidenceJson = claimColumns.some((column) => column.name === 'confidence_json');
    if (!hasConfidenceJson) {
      this.db.exec('ALTER TABLE evidence_claims ADD COLUMN confidence_json TEXT');
    }

    // Edges table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_edges (
        id TEXT PRIMARY KEY,
        from_claim_id TEXT NOT NULL,
        to_claim_id TEXT NOT NULL,
        type TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (from_claim_id) REFERENCES evidence_claims(id) ON DELETE CASCADE,
        FOREIGN KEY (to_claim_id) REFERENCES evidence_claims(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_edges_from ON evidence_edges(from_claim_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON evidence_edges(to_claim_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON evidence_edges(type);
    `);

    // Defeaters table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_defeaters (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        activated_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        evidence TEXT,
        affected_claim_ids TEXT NOT NULL,
        confidence_reduction REAL NOT NULL DEFAULT 0.2,
        auto_resolvable INTEGER NOT NULL DEFAULT 0,
        resolution_action TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_defeaters_type ON evidence_defeaters(type);
      CREATE INDEX IF NOT EXISTS idx_defeaters_status ON evidence_defeaters(status);
      CREATE INDEX IF NOT EXISTS idx_defeaters_severity ON evidence_defeaters(severity);
    `);

    // Contradictions table (NEVER silently removed)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_contradictions (
        id TEXT PRIMARY KEY,
        claim_a TEXT NOT NULL,
        claim_b TEXT NOT NULL,
        type TEXT NOT NULL,
        explanation TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unresolved',
        severity TEXT NOT NULL DEFAULT 'significant',
        resolution_method TEXT,
        resolution_explanation TEXT,
        resolution_resolver TEXT,
        resolution_resolved_at TEXT,
        resolution_tradeoff TEXT,
        FOREIGN KEY (claim_a) REFERENCES evidence_claims(id),
        FOREIGN KEY (claim_b) REFERENCES evidence_claims(id)
      );
      CREATE INDEX IF NOT EXISTS idx_contradictions_status ON evidence_contradictions(status);
      CREATE INDEX IF NOT EXISTS idx_contradictions_claims ON evidence_contradictions(claim_a, claim_b);
    `);

    // Graph metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_graph_meta (
        workspace TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        claim_count INTEGER NOT NULL DEFAULT 0,
        active_defeater_count INTEGER NOT NULL DEFAULT 0,
        unresolved_contradiction_count INTEGER NOT NULL DEFAULT 0,
        health REAL NOT NULL DEFAULT 1.0,
        calibration_ece REAL,
        calibration_brier REAL,
        calibration_last_calibrated TEXT
      );
    `);
  }

  // Claims
  async getClaim(id: ClaimId): Promise<Claim | null> {
    if (!this.db) throw new Error('Storage not initialized');

    const row = this.db.prepare('SELECT * FROM evidence_claims WHERE id = ?').get(id) as ClaimRow | undefined;
    return row ? this.rowToClaim(row) : null;
  }

  async getClaims(options: ClaimQueryOptions = {}): Promise<Claim[]> {
    if (!this.db) throw new Error('Storage not initialized');

    let sql = 'SELECT * FROM evidence_claims WHERE 1=1';
    const params: unknown[] = [];

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options.subjectType) {
      sql += ' AND subject_type = ?';
      params.push(options.subjectType);
    }
    if (options.subjectId) {
      sql += ' AND subject_id = ?';
      params.push(options.subjectId);
    }
    if (options.minSignalStrength !== undefined) {
      sql += ' AND confidence_overall >= ?';
      params.push(options.minSignalStrength);
    }

    const orderBy = options.orderBy ?? 'created_at';
    const orderDir = options.orderDir ?? 'DESC';
    sql += ` ORDER BY ${orderBy === 'signalStrength' ? 'confidence_overall' : orderBy === 'createdAt' ? 'created_at' : orderBy} ${orderDir}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as ClaimRow[];
    return rows.map((row) => this.rowToClaim(row));
  }

  async getClaimsBySubject(subjectId: string): Promise<Claim[]> {
    return this.getClaims({ subjectId });
  }

  async upsertClaim(claim: Claim): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO evidence_claims (
        id, proposition, type, subject_type, subject_id, subject_name, subject_location,
        source_type, source_id, source_version, source_trace_id,
        status, confidence_json, confidence_overall, confidence_retrieval, confidence_structural,
        confidence_semantic, confidence_test_execution, confidence_recency,
        confidence_aggregation_method, schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      claim.id,
      claim.proposition,
      claim.type,
      claim.subject.type,
      claim.subject.id,
      claim.subject.name,
      claim.subject.location ? JSON.stringify(claim.subject.location) : null,
      claim.source.type,
      claim.source.id,
      claim.source.version ?? null,
      claim.source.traceId ?? null,
      claim.status,
      JSON.stringify(claim.confidence),
      claim.signalStrength.overall,
      claim.signalStrength.retrieval,
      claim.signalStrength.structural,
      claim.signalStrength.semantic,
      claim.signalStrength.testExecution,
      claim.signalStrength.recency,
      claim.signalStrength.aggregationMethod,
      claim.schemaVersion,
      claim.createdAt
    );
  }

  async upsertClaims(claims: Claim[]): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    const transaction = this.db.transaction(() => {
      for (const claim of claims) {
        this.upsertClaim(claim);
      }
    });
    transaction();
  }

  async deleteClaim(id: ClaimId): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare('DELETE FROM evidence_claims WHERE id = ?').run(id);
  }

  async updateClaimStatus(id: ClaimId, status: Claim['status']): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare('UPDATE evidence_claims SET status = ? WHERE id = ?').run(status, id);
  }

  async updateClaimSignalStrength(id: ClaimId, signalStrength: ClaimSignalStrength): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare(`
      UPDATE evidence_claims SET
        confidence_overall = ?,
        confidence_retrieval = ?,
        confidence_structural = ?,
        confidence_semantic = ?,
        confidence_test_execution = ?,
        confidence_recency = ?,
        confidence_aggregation_method = ?
      WHERE id = ?
    `).run(
      signalStrength.overall,
      signalStrength.retrieval,
      signalStrength.structural,
      signalStrength.semantic,
      signalStrength.testExecution,
      signalStrength.recency,
      signalStrength.aggregationMethod,
      id
    );
  }

  // Edges
  async getEdge(id: string): Promise<EvidenceEdge | null> {
    if (!this.db) throw new Error('Storage not initialized');
    const row = this.db.prepare('SELECT * FROM evidence_edges WHERE id = ?').get(id) as EdgeRow | undefined;
    return row ? this.rowToEdge(row) : null;
  }

  async getEdges(options: EdgeQueryOptions = {}): Promise<EvidenceEdge[]> {
    if (!this.db) throw new Error('Storage not initialized');

    let sql = 'SELECT * FROM evidence_edges WHERE 1=1';
    const params: unknown[] = [];

    if (options.fromClaimId) {
      sql += ' AND from_claim_id = ?';
      params.push(options.fromClaimId);
    }
    if (options.toClaimId) {
      sql += ' AND to_claim_id = ?';
      params.push(options.toClaimId);
    }
    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    if (options.minStrength !== undefined) {
      sql += ' AND strength >= ?';
      params.push(options.minStrength);
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map((row) => this.rowToEdge(row));
  }

  async getEdgesFrom(claimId: ClaimId): Promise<EvidenceEdge[]> {
    return this.getEdges({ fromClaimId: claimId });
  }

  async getEdgesTo(claimId: ClaimId): Promise<EvidenceEdge[]> {
    return this.getEdges({ toClaimId: claimId });
  }

  async upsertEdge(edge: EvidenceEdge): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    this.db.prepare(`
      INSERT OR REPLACE INTO evidence_edges (
        id, from_claim_id, to_claim_id, type, strength, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      edge.id,
      edge.fromClaimId,
      edge.toClaimId,
      edge.type,
      edge.strength,
      edge.createdAt,
      edge.metadata ? JSON.stringify(edge.metadata) : null
    );
  }

  async upsertEdges(edges: EvidenceEdge[]): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    const transaction = this.db.transaction(() => {
      for (const edge of edges) {
        this.upsertEdge(edge);
      }
    });
    transaction();
  }

  async deleteEdge(id: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare('DELETE FROM evidence_edges WHERE id = ?').run(id);
  }

  async deleteEdgesForClaim(claimId: ClaimId): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare('DELETE FROM evidence_edges WHERE from_claim_id = ? OR to_claim_id = ?').run(claimId, claimId);
  }

  // Defeaters
  async getDefeater(id: string): Promise<ExtendedDefeater | null> {
    if (!this.db) throw new Error('Storage not initialized');
    const row = this.db.prepare('SELECT * FROM evidence_defeaters WHERE id = ?').get(id) as DefeaterRow | undefined;
    return row ? this.rowToDefeater(row) : null;
  }

  async getDefeaters(options: DefeaterQueryOptions = {}): Promise<ExtendedDefeater[]> {
    if (!this.db) throw new Error('Storage not initialized');

    let sql = 'SELECT * FROM evidence_defeaters WHERE 1=1';
    const params: unknown[] = [];

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options.severity) {
      sql += ' AND severity = ?';
      params.push(options.severity);
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as DefeaterRow[];
    return rows.map((row) => this.rowToDefeater(row));
  }

  async getActiveDefeaters(): Promise<ExtendedDefeater[]> {
    return this.getDefeaters({ status: 'active' });
  }

  async getDefeatersForClaim(claimId: ClaimId): Promise<ExtendedDefeater[]> {
    if (!this.db) throw new Error('Storage not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM evidence_defeaters WHERE affected_claim_ids LIKE ?
    `).all(`%${claimId}%`) as DefeaterRow[];

    return rows.map((row) => this.rowToDefeater(row));
  }

  async upsertDefeater(defeater: ExtendedDefeater): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    this.db.prepare(`
      INSERT OR REPLACE INTO evidence_defeaters (
        id, type, description, severity, detected_at, activated_at, status,
        evidence, affected_claim_ids, confidence_reduction, auto_resolvable, resolution_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      defeater.id,
      defeater.type,
      defeater.description,
      defeater.severity,
      defeater.detectedAt,
      defeater.activatedAt ?? null,
      defeater.status,
      defeater.evidence ?? null,
      JSON.stringify(defeater.affectedClaimIds),
      defeater.confidenceReduction,
      defeater.autoResolvable ? 1 : 0,
      defeater.resolutionAction ?? null
    );
  }

  async upsertDefeaters(defeaters: ExtendedDefeater[]): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    const transaction = this.db.transaction(() => {
      for (const defeater of defeaters) {
        this.upsertDefeater(defeater);
      }
    });
    transaction();
  }

  async deleteDefeater(id: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare('DELETE FROM evidence_defeaters WHERE id = ?').run(id);
  }

  async activateDefeater(id: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare(`
      UPDATE evidence_defeaters SET status = 'active', activated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
  }

  async resolveDefeater(id: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    this.db.prepare(`UPDATE evidence_defeaters SET status = 'resolved' WHERE id = ?`).run(id);
  }

  // Contradictions
  async getContradiction(id: string): Promise<Contradiction | null> {
    if (!this.db) throw new Error('Storage not initialized');
    const row = this.db.prepare('SELECT * FROM evidence_contradictions WHERE id = ?').get(id) as ContradictionRow | undefined;
    return row ? this.rowToContradiction(row) : null;
  }

  async getContradictions(options: ContradictionQueryOptions = {}): Promise<Contradiction[]> {
    if (!this.db) throw new Error('Storage not initialized');

    let sql = 'SELECT * FROM evidence_contradictions WHERE 1=1';
    const params: unknown[] = [];

    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options.severity) {
      sql += ' AND severity = ?';
      params.push(options.severity);
    }
    if (options.claimId) {
      sql += ' AND (claim_a = ? OR claim_b = ?)';
      params.push(options.claimId, options.claimId);
    }
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as ContradictionRow[];
    return rows.map((row) => this.rowToContradiction(row));
  }

  async getUnresolvedContradictions(): Promise<Contradiction[]> {
    return this.getContradictions({ status: 'unresolved' });
  }

  async getContradictionsForClaim(claimId: ClaimId): Promise<Contradiction[]> {
    return this.getContradictions({ claimId });
  }

  async upsertContradiction(contradiction: Contradiction): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    this.db.prepare(`
      INSERT OR REPLACE INTO evidence_contradictions (
        id, claim_a, claim_b, type, explanation, detected_at, status, severity,
        resolution_method, resolution_explanation, resolution_resolver, resolution_resolved_at, resolution_tradeoff
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contradiction.id,
      contradiction.claimA,
      contradiction.claimB,
      contradiction.type,
      contradiction.explanation,
      contradiction.detectedAt,
      contradiction.status,
      contradiction.severity,
      contradiction.resolution?.method ?? null,
      contradiction.resolution?.explanation ?? null,
      contradiction.resolution?.resolver ?? null,
      contradiction.resolution?.resolvedAt ?? null,
      contradiction.resolution?.tradeoff ?? null
    );
  }

  async deleteContradiction(id: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    // NOTE: Contradictions should rarely be deleted - they should be resolved
    this.db.prepare('DELETE FROM evidence_contradictions WHERE id = ?').run(id);
  }

  async resolveContradiction(id: string, resolution: Contradiction['resolution']): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    if (!resolution) throw new Error('Resolution required');

    this.db.prepare(`
      UPDATE evidence_contradictions SET
        status = 'resolved',
        resolution_method = ?,
        resolution_explanation = ?,
        resolution_resolver = ?,
        resolution_resolved_at = ?,
        resolution_tradeoff = ?
      WHERE id = ?
    `).run(
      resolution.method,
      resolution.explanation,
      resolution.resolver,
      resolution.resolvedAt,
      resolution.tradeoff,
      id
    );
  }

  // Graph operations
  async getFullGraph(workspace: string): Promise<EvidenceGraph> {
    if (!this.db) throw new Error('Storage not initialized');

    const claims = await this.getClaims({});
    const edges = await this.getEdges({});
    const defeaters = await this.getDefeaters({});
    const contradictions = await this.getContradictions({});

    const graph = createEmptyEvidenceGraph(workspace);

    for (const claim of claims) {
      graph.claims.set(claim.id, claim);
    }
    graph.edges = edges;
    graph.defeaters = defeaters;
    graph.contradictions = contradictions;

    // Update meta
    graph.meta.claimCount = claims.length;
    graph.meta.activeDefeaterCount = defeaters.filter((d) => d.status === 'active').length;
    graph.meta.unresolvedContradictionCount = contradictions.filter((c) => c.status === 'unresolved').length;
    graph.meta.updatedAt = new Date().toISOString();

    // Calculate health based on defeaters and contradictions
    const maxDefeaters = Math.max(10, claims.length * 0.1);
    const defeaterPenalty = Math.min(1, graph.meta.activeDefeaterCount / maxDefeaters) * 0.3;
    const contradictionPenalty = Math.min(1, graph.meta.unresolvedContradictionCount / 5) * 0.3;
    graph.meta.health = Math.max(0, 1 - defeaterPenalty - contradictionPenalty);

    return graph;
  }

  async saveFullGraph(graph: EvidenceGraph): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');

    const transaction = this.db.transaction(() => {
      // Save all claims
      for (const claim of graph.claims.values()) {
        this.upsertClaim(claim);
      }

      // Save all edges
      for (const edge of graph.edges) {
        this.upsertEdge(edge);
      }

      // Save all defeaters
      for (const defeater of graph.defeaters) {
        this.upsertDefeater(defeater);
      }

      // Save all contradictions
      for (const contradiction of graph.contradictions) {
        this.upsertContradiction(contradiction);
      }

      // Save meta
      this.db!.prepare(`
        INSERT OR REPLACE INTO evidence_graph_meta (
          workspace, schema_version, created_at, updated_at,
          claim_count, active_defeater_count, unresolved_contradiction_count, health,
          calibration_ece, calibration_brier, calibration_last_calibrated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        graph.workspace,
        graph.schemaVersion,
        graph.meta.createdAt,
        graph.meta.updatedAt,
        graph.meta.claimCount,
        graph.meta.activeDefeaterCount,
        graph.meta.unresolvedContradictionCount,
        graph.meta.health,
        graph.meta.calibration?.expectedCalibrationError ?? null,
        graph.meta.calibration?.brierScore ?? null,
        graph.meta.calibration?.lastCalibrated ?? null
      );
    });

    transaction();
  }

  async traverseFrom(claimId: ClaimId, maxDepth: number): Promise<TraversalResult> {
    if (!this.db) throw new Error('Storage not initialized');

    const visitedClaims = new Set<string>();
    const resultClaims: Claim[] = [];
    const resultEdges: EvidenceEdge[] = [];
    let currentDepth = 0;
    let lastProcessedDepth = 0;

    // BFS traversal
    let frontier: ClaimId[] = [claimId];

    while (frontier.length > 0 && currentDepth <= maxDepth) {
      const nextFrontier: ClaimId[] = [];
      lastProcessedDepth = currentDepth;

      for (const cid of frontier) {
        if (visitedClaims.has(cid)) continue;
        visitedClaims.add(cid);

        const claim = await this.getClaim(cid);
        if (claim) {
          resultClaims.push(claim);
        }

        const outEdges = await this.getEdgesFrom(cid);
        for (const edge of outEdges) {
          resultEdges.push(edge);
          if (!visitedClaims.has(edge.toClaimId)) {
            nextFrontier.push(edge.toClaimId);
          }
        }
      }

      frontier = nextFrontier;
      currentDepth++;
    }

    return {
      claims: resultClaims,
      edges: resultEdges,
      maxDepth: lastProcessedDepth,
    };
  }

  async findPath(fromClaimId: ClaimId, toClaimId: ClaimId): Promise<EvidenceEdge[]> {
    if (!this.db) throw new Error('Storage not initialized');

    // BFS to find shortest path
    const visited = new Set<string>();
    const parent = new Map<string, { claim: ClaimId; edge: EvidenceEdge }>();
    const queue: ClaimId[] = [fromClaimId];

    visited.add(fromClaimId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === toClaimId) {
        // Reconstruct path
        const path: EvidenceEdge[] = [];
        let node = toClaimId;
        while (parent.has(node)) {
          const p = parent.get(node)!;
          path.unshift(p.edge);
          node = p.claim;
        }
        return path;
      }

      const edges = await this.getEdgesFrom(current);
      for (const edge of edges) {
        if (!visited.has(edge.toClaimId)) {
          visited.add(edge.toClaimId);
          parent.set(edge.toClaimId, { claim: current, edge });
          queue.push(edge.toClaimId);
        }
      }
    }

    return []; // No path found
  }

  // Statistics
  async getGraphStats(): Promise<GraphStats> {
    if (!this.db) throw new Error('Storage not initialized');

    const claimCount = (this.db.prepare('SELECT COUNT(*) as count FROM evidence_claims').get() as { count: number }).count;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as count FROM evidence_edges').get() as { count: number }).count;
    const activeDefeaterCount = (this.db.prepare("SELECT COUNT(*) as count FROM evidence_defeaters WHERE status = 'active'").get() as { count: number }).count;
    const unresolvedContradictionCount = (this.db.prepare("SELECT COUNT(*) as count FROM evidence_contradictions WHERE status = 'unresolved'").get() as { count: number }).count;
    const avgSignalStrengthRow = this.db.prepare('SELECT AVG(confidence_overall) as avg FROM evidence_claims').get() as { avg: number | null };
    const staleClaims = (this.db.prepare("SELECT COUNT(*) as count FROM evidence_claims WHERE status = 'stale'").get() as { count: number }).count;

    return {
      claimCount,
      edgeCount,
      activeDefeaterCount,
      unresolvedContradictionCount,
      avgSignalStrength: avgSignalStrengthRow.avg ?? 0,
      staleClaims,
    };
  }

  // Row conversion helpers
  private rowToClaim(row: ClaimRow): Claim {
    return {
      id: createClaimId(row.id),
      proposition: row.proposition,
      type: row.type as Claim['type'],
      subject: {
        type: row.subject_type as Claim['subject']['type'],
        id: row.subject_id,
        name: row.subject_name,
        location: row.subject_location ? JSON.parse(row.subject_location) : undefined,
      },
      source: {
        type: row.source_type as Claim['source']['type'],
        id: row.source_id,
        version: row.source_version ?? undefined,
        traceId: row.source_trace_id ?? undefined,
      },
      status: row.status as Claim['status'],
      confidence: row.confidence_json
        ? (JSON.parse(row.confidence_json) as Claim['confidence'])
        : absent('uncalibrated'),
      signalStrength: {
        overall: row.confidence_overall,
        retrieval: row.confidence_retrieval,
        structural: row.confidence_structural,
        semantic: row.confidence_semantic,
        testExecution: row.confidence_test_execution,
        recency: row.confidence_recency,
        aggregationMethod: row.confidence_aggregation_method as ClaimSignalStrength['aggregationMethod'],
      },
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
    };
  }

  private rowToEdge(row: EdgeRow): EvidenceEdge {
    return {
      id: row.id,
      fromClaimId: createClaimId(row.from_claim_id),
      toClaimId: createClaimId(row.to_claim_id),
      type: row.type as EvidenceEdge['type'],
      strength: row.strength,
      createdAt: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToDefeater(row: DefeaterRow): ExtendedDefeater {
    return {
      id: row.id,
      type: row.type as ExtendedDefeater['type'],
      description: row.description,
      severity: row.severity as ExtendedDefeater['severity'],
      detectedAt: row.detected_at,
      activatedAt: row.activated_at ?? undefined,
      status: row.status as ExtendedDefeater['status'],
      evidence: row.evidence ?? undefined,
      affectedClaimIds: JSON.parse(row.affected_claim_ids) as ClaimId[],
      confidenceReduction: row.confidence_reduction,
      autoResolvable: row.auto_resolvable === 1,
      resolutionAction: row.resolution_action ?? undefined,
    };
  }

  private rowToContradiction(row: ContradictionRow): Contradiction {
    const contradiction: Contradiction = {
      id: row.id,
      claimA: createClaimId(row.claim_a),
      claimB: createClaimId(row.claim_b),
      type: row.type as Contradiction['type'],
      explanation: row.explanation,
      detectedAt: row.detected_at,
      status: row.status as Contradiction['status'],
      severity: row.severity as Contradiction['severity'],
    };

    if (row.resolution_method) {
      contradiction.resolution = {
        method: row.resolution_method as NonNullable<Contradiction['resolution']>['method'],
        explanation: row.resolution_explanation!,
        resolver: row.resolution_resolver!,
        resolvedAt: row.resolution_resolved_at!,
        tradeoff: row.resolution_tradeoff!,
      };
    }

    return contradiction;
  }
}

// Row types for SQLite results
interface ClaimRow {
  id: string;
  proposition: string;
  type: string;
  subject_type: string;
  subject_id: string;
  subject_name: string;
  subject_location: string | null;
  source_type: string;
  source_id: string;
  source_version: string | null;
  source_trace_id: string | null;
  status: string;
  confidence_json: string | null;
  confidence_overall: number;
  confidence_retrieval: number;
  confidence_structural: number;
  confidence_semantic: number;
  confidence_test_execution: number;
  confidence_recency: number;
  confidence_aggregation_method: string;
  schema_version: string;
  created_at: string;
}

interface EdgeRow {
  id: string;
  from_claim_id: string;
  to_claim_id: string;
  type: string;
  strength: number;
  created_at: string;
  metadata: string | null;
}

interface DefeaterRow {
  id: string;
  type: string;
  description: string;
  severity: string;
  detected_at: string;
  activated_at: string | null;
  status: string;
  evidence: string | null;
  affected_claim_ids: string;
  confidence_reduction: number;
  auto_resolvable: number;
  resolution_action: string | null;
}

interface ContradictionRow {
  id: string;
  claim_a: string;
  claim_b: string;
  type: string;
  explanation: string;
  detected_at: string;
  status: string;
  severity: string;
  resolution_method: string | null;
  resolution_explanation: string | null;
  resolution_resolver: string | null;
  resolution_resolved_at: string | null;
  resolution_tradeoff: string | null;
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an evidence graph storage instance.
 */
export function createEvidenceGraphStorage(
  dbPath: string,
  workspace: string
): EvidenceGraphStorage {
  return new SqliteEvidenceGraphStorage(dbPath, workspace);
}
