/**
 * @fileoverview Symbol Storage for Direct Symbol Lookup
 *
 * Provides persistent storage for the SymbolTable, enabling:
 * - Fast exact name lookup for symbols (classes, interfaces, types, etc.)
 * - Pattern-based fuzzy matching
 * - File-based symbol listing
 *
 * This is a separate storage module from the main LiBrainianStorage to:
 * 1. Keep the symbol table focused and efficient
 * 2. Avoid bloating the main storage interface
 * 3. Enable independent versioning and migration
 *
 * @packageDocumentation
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { SymbolEntry, SymbolKind } from '../constructions/symbol_table.js';
import { SymbolTable } from '../constructions/symbol_table.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SymbolQueryOptions {
  /** Filter by symbol kind */
  kind?: SymbolKind;

  /** Filter by file path */
  file?: string;

  /** Only return exported symbols */
  exportedOnly?: boolean;

  /** Maximum number of results */
  limit?: number;

  /** Pattern for fuzzy matching */
  pattern?: string;
}

export interface SymbolStorageStats {
  totalSymbols: number;
  byKind: Record<SymbolKind, number>;
  filesWithSymbols: number;
  lastUpdated: string | null;
}

// ============================================================================
// SYMBOL STORAGE CLASS
// ============================================================================

/**
 * SQLite-backed storage for the symbol table.
 *
 * The symbol storage is initialized alongside the main librainian database
 * but uses its own table for symbol data.
 */
export class SymbolStorage {
  private db: ReturnType<typeof Database> | null = null;
  private readonly dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the symbol storage.
   * Creates the symbols table if it doesn't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.ensureSymbolTable();
    this.initialized = true;
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  /**
   * Check if the storage is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureDb(): ReturnType<typeof Database> {
    if (!this.db) {
      throw new Error('SymbolStorage not initialized. Call initialize() first.');
    }
    return this.db;
  }

  private ensureSymbolTable(): void {
    const db = this.ensureDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS librainian_symbols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        kind TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        end_line INTEGER,
        signature TEXT,
        exported INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        qualified_name TEXT,
        indexed_at TEXT NOT NULL
      );

      -- Index for exact name lookup (most common query)
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON librainian_symbols(name);

      -- Index for case-insensitive lookup
      CREATE INDEX IF NOT EXISTS idx_symbols_name_lower ON librainian_symbols(name_lower);

      -- Index for kind-based filtering
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON librainian_symbols(kind);

      -- Index for file-based listing
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON librainian_symbols(file);

      -- Index for exported symbols
      CREATE INDEX IF NOT EXISTS idx_symbols_exported ON librainian_symbols(exported);

      -- Composite index for name + kind queries
      CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON librainian_symbols(name, kind);
    `);
  }

  /**
   * Upsert a single symbol.
   */
  upsertSymbol(entry: SymbolEntry): void {
    const db = this.ensureDb();
    const id = `${entry.file}:${entry.name}:${entry.line}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO librainian_symbols
      (id, name, name_lower, kind, file, line, end_line, signature, exported, description, qualified_name, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.name,
      entry.name.toLowerCase(),
      entry.kind,
      entry.file,
      entry.line,
      entry.endLine ?? null,
      entry.signature ?? null,
      entry.exported ? 1 : 0,
      entry.description ?? null,
      entry.qualifiedName ?? null,
      now
    );
  }

  /**
   * Upsert multiple symbols in a transaction.
   */
  upsertSymbols(entries: SymbolEntry[]): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO librainian_symbols
      (id, name, name_lower, kind, file, line, end_line, signature, exported, description, qualified_name, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((symbols: SymbolEntry[]) => {
      for (const entry of symbols) {
        const id = `${entry.file}:${entry.name}:${entry.line}`;
        stmt.run(
          id,
          entry.name,
          entry.name.toLowerCase(),
          entry.kind,
          entry.file,
          entry.line,
          entry.endLine ?? null,
          entry.signature ?? null,
          entry.exported ? 1 : 0,
          entry.description ?? null,
          entry.qualifiedName ?? null,
          now
        );
      }
    });

    insertMany(entries);
  }

  /**
   * Find symbols by exact name.
   */
  findByExactName(name: string): SymbolEntry[] {
    const db = this.ensureDb();
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols WHERE name = ?
    `).all(name) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Find symbols by exact name (case-insensitive).
   */
  findByExactNameIgnoreCase(name: string): SymbolEntry[] {
    const db = this.ensureDb();
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols WHERE name_lower = ?
    `).all(name.toLowerCase()) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Find symbols by exact name and kind.
   */
  findByExactNameAndKind(name: string, kind: SymbolKind): SymbolEntry[] {
    const db = this.ensureDb();
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols WHERE name = ? AND kind = ?
    `).all(name, kind) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Find symbols by fuzzy name match (LIKE pattern).
   */
  findByFuzzyName(pattern: string): SymbolEntry[] {
    const db = this.ensureDb();
    const likePattern = `%${pattern.toLowerCase()}%`;
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols
      WHERE name_lower LIKE ?
      ORDER BY
        CASE WHEN name_lower = ? THEN 0 ELSE 1 END,
        LENGTH(name)
      LIMIT 50
    `).all(likePattern, pattern.toLowerCase()) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Find symbols by fuzzy name and kind.
   */
  findByFuzzyNameAndKind(pattern: string, kind: SymbolKind): SymbolEntry[] {
    const db = this.ensureDb();
    const likePattern = `%${pattern.toLowerCase()}%`;
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols
      WHERE name_lower LIKE ? AND kind = ?
      ORDER BY
        CASE WHEN name_lower = ? THEN 0 ELSE 1 END,
        LENGTH(name)
      LIMIT 50
    `).all(likePattern, kind, pattern.toLowerCase()) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Find symbols by file path.
   */
  findByFile(filePath: string): SymbolEntry[] {
    const db = this.ensureDb();
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols WHERE file = ? ORDER BY line
    `).all(filePath) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Find symbols by kind.
   */
  findByKind(kind: SymbolKind): SymbolEntry[] {
    const db = this.ensureDb();
    const rows = db.prepare(`
      SELECT * FROM librainian_symbols WHERE kind = ? ORDER BY name
    `).all(kind) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Query symbols with options.
   */
  querySymbols(options: SymbolQueryOptions = {}): SymbolEntry[] {
    const db = this.ensureDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.kind) {
      conditions.push('kind = ?');
      params.push(options.kind);
    }

    if (options.file) {
      conditions.push('file = ?');
      params.push(options.file);
    }

    if (options.exportedOnly) {
      conditions.push('exported = 1');
    }

    if (options.pattern) {
      conditions.push('name_lower LIKE ?');
      params.push(`%${options.pattern.toLowerCase()}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

    const rows = db.prepare(`
      SELECT * FROM librainian_symbols ${whereClause} ORDER BY name ${limitClause}
    `).all(...params) as SymbolRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Delete symbols for a file (for re-indexing).
   */
  deleteSymbolsForFile(filePath: string): number {
    const db = this.ensureDb();
    const result = db.prepare(`
      DELETE FROM librainian_symbols WHERE file = ?
    `).run(filePath);
    return result.changes;
  }

  /**
   * Clear all symbols.
   */
  clearAll(): void {
    const db = this.ensureDb();
    db.exec('DELETE FROM librainian_symbols');
  }

  /**
   * Get storage statistics.
   */
  getStats(): SymbolStorageStats {
    const db = this.ensureDb();

    const totalRow = db.prepare('SELECT COUNT(*) as count FROM librainian_symbols').get() as { count: number };
    const filesRow = db.prepare('SELECT COUNT(DISTINCT file) as count FROM librainian_symbols').get() as { count: number };
    const lastUpdatedRow = db.prepare('SELECT MAX(indexed_at) as last FROM librainian_symbols').get() as { last: string | null };

    const kindCounts = db.prepare(`
      SELECT kind, COUNT(*) as count FROM librainian_symbols GROUP BY kind
    `).all() as Array<{ kind: string; count: number }>;

    const byKind: Record<SymbolKind, number> = {
      class: 0,
      function: 0,
      interface: 0,
      type: 0,
      const: 0,
      enum: 0,
      variable: 0,
      namespace: 0,
      method: 0,
      property: 0,
      getter: 0,
      setter: 0,
      're-export': 0,
      'barrel-export': 0,
      'default-export': 0,
    };

    for (const row of kindCounts) {
      if (row.kind in byKind) {
        byKind[row.kind as SymbolKind] = row.count;
      }
    }

    return {
      totalSymbols: totalRow.count,
      byKind,
      filesWithSymbols: filesRow.count,
      lastUpdated: lastUpdatedRow.last,
    };
  }

  /**
   * Load all symbols into a SymbolTable for in-memory queries.
   */
  loadIntoSymbolTable(): SymbolTable {
    const db = this.ensureDb();
    const rows = db.prepare('SELECT * FROM librainian_symbols').all() as SymbolRow[];

    const table = new SymbolTable();
    table.addSymbols(rows.map(rowToEntry));

    return table;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

interface SymbolRow {
  id: string;
  name: string;
  name_lower: string;
  kind: string;
  file: string;
  line: number;
  end_line: number | null;
  signature: string | null;
  exported: number;
  description: string | null;
  qualified_name: string | null;
  indexed_at: string;
}

function rowToEntry(row: SymbolRow): SymbolEntry {
  return {
    name: row.name,
    kind: row.kind as SymbolKind,
    file: row.file,
    line: row.line,
    endLine: row.end_line ?? undefined,
    signature: row.signature ?? undefined,
    exported: row.exported === 1,
    description: row.description ?? undefined,
    qualifiedName: row.qualified_name ?? undefined,
  };
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a symbol storage instance for a given workspace.
 * Uses the same database as the main librainian storage.
 */
export function createSymbolStorage(workspaceRoot: string): SymbolStorage {
  const dbPath = path.join(workspaceRoot, '.librainian', 'knowledge.db');
  return new SymbolStorage(dbPath);
}

/**
 * Create a symbol storage instance with a custom database path.
 */
export function createSymbolStorageWithPath(dbPath: string): SymbolStorage {
  return new SymbolStorage(dbPath);
}
