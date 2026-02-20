import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import type Database from 'better-sqlite3';
import { computeCanonRef, computeEnvironmentRef } from '../spine/refs.js';
import { noResult } from './empty_values.js';
import { LIBRARIAN_VERSION } from '../index.js';

export interface MigrationDefinition { version: number; name: string; file: string; }
export interface AppliedMigration { version: number; name: string; checksum: string; }
export interface LibrarianSchemaMigrationReportV1 {
  kind: 'LibrarianSchemaMigrationReport.v1';
  schema_version: 1;
  created_at: string;
  canon: Awaited<ReturnType<typeof computeCanonRef>>;
  environment: ReturnType<typeof computeEnvironmentRef>;
  workspace: string;
  from_version: number;
  to_version: number;
  applied: AppliedMigration[];
}

const INLINE_MIGRATIONS: Record<string, string> = {
  '002_ingestion': [
    'CREATE TABLE IF NOT EXISTS librarian_ingested_items (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_version TEXT NOT NULL, ingested_at TEXT NOT NULL, payload TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT \"{}\");',
    'CREATE INDEX IF NOT EXISTS idx_ingested_items_source ON librarian_ingested_items(source_type);',
    'CREATE INDEX IF NOT EXISTS idx_ingested_items_ingested_at ON librarian_ingested_items(ingested_at);',
  ].join('\n'),
  '003_file_checksums': [
    'CREATE TABLE IF NOT EXISTS librarian_file_checksums (file_path TEXT PRIMARY KEY, checksum TEXT NOT NULL, updated_at TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS idx_file_checksums_updated ON librarian_file_checksums(updated_at);',
  ].join('\n'),
  '004_graph_edges': [
    'CREATE TABLE IF NOT EXISTS librarian_graph_edges (from_id TEXT NOT NULL, from_type TEXT NOT NULL, to_id TEXT NOT NULL, to_type TEXT NOT NULL, edge_type TEXT NOT NULL, source_file TEXT NOT NULL, source_line INTEGER, confidence REAL NOT NULL, computed_at TEXT NOT NULL, PRIMARY KEY (from_id, to_id, edge_type, source_file));',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON librarian_graph_edges(from_id);',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON librarian_graph_edges(to_id);',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_file ON librarian_graph_edges(source_file);',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON librarian_graph_edges(edge_type, from_type);',
  ].join('\n'),
  '005_query_cache': [
    'CREATE TABLE IF NOT EXISTS librarian_query_cache (query_hash TEXT PRIMARY KEY, query_params TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL, access_count INTEGER NOT NULL DEFAULT 1);',
    'CREATE INDEX IF NOT EXISTS idx_query_cache_accessed ON librarian_query_cache(last_accessed DESC);',
  ].join('\n'),
  '006_test_mapping': [
    'CREATE TABLE IF NOT EXISTS librarian_test_mapping (id TEXT PRIMARY KEY, test_path TEXT NOT NULL, source_path TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS idx_test_mapping_test_path ON librarian_test_mapping(test_path);',
    'CREATE INDEX IF NOT EXISTS idx_test_mapping_source_path ON librarian_test_mapping(source_path);',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_test_mapping_unique ON librarian_test_mapping(test_path, source_path);',
  ].join('\n'),
  '007_commits': [
    'CREATE TABLE IF NOT EXISTS librarian_commits (id TEXT PRIMARY KEY, sha TEXT NOT NULL UNIQUE, message TEXT NOT NULL, author TEXT NOT NULL, category TEXT NOT NULL, files_changed TEXT NOT NULL, created_at TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS idx_commits_sha ON librarian_commits(sha);',
    'CREATE INDEX IF NOT EXISTS idx_commits_author ON librarian_commits(author);',
    'CREATE INDEX IF NOT EXISTS idx_commits_category ON librarian_commits(category);',
    'CREATE INDEX IF NOT EXISTS idx_commits_created_at ON librarian_commits(created_at DESC);',
  ].join('\n'),
  '008_ownership': [
    'CREATE TABLE IF NOT EXISTS librarian_ownership (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, author TEXT NOT NULL, score REAL NOT NULL, last_modified TEXT NOT NULL, created_at TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS idx_ownership_file_path ON librarian_ownership(file_path);',
    'CREATE INDEX IF NOT EXISTS idx_ownership_author ON librarian_ownership(author);',
    'CREATE INDEX IF NOT EXISTS idx_ownership_score ON librarian_ownership(score DESC);',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_unique ON librarian_ownership(file_path, author);',
  ].join('\n'),
  '009_multi_vectors': [
    'CREATE TABLE IF NOT EXISTS librarian_multi_vectors (entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, payload TEXT NOT NULL, model_id TEXT NOT NULL, generated_at TEXT NOT NULL, token_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (entity_id, entity_type));',
    'CREATE INDEX IF NOT EXISTS idx_multi_vectors_type ON librarian_multi_vectors(entity_type);',
  ].join('\n'),
  '011_indexing_history_skips': [
    'ALTER TABLE librarian_indexing_history ADD COLUMN files_skipped INTEGER NOT NULL DEFAULT 0;',
  ].join('\n'),
};

const MIGRATIONS: MigrationDefinition[] = [
  { version: 1, name: 'initial', file: '001_initial.sql' },
  { version: 2, name: 'ingestion', file: 'inline:002_ingestion' },
  { version: 3, name: 'file_checksums', file: 'inline:003_file_checksums' },
  { version: 4, name: 'graph_edges', file: 'inline:004_graph_edges' },
  { version: 5, name: 'query_cache', file: 'inline:005_query_cache' },
  { version: 6, name: 'test_mapping', file: 'inline:006_test_mapping' },
  { version: 7, name: 'commits', file: 'inline:007_commits' },
  { version: 8, name: 'ownership', file: 'inline:008_ownership' },
  { version: 9, name: 'multi_vectors', file: 'inline:009_multi_vectors' },
  { version: 10, name: 'advanced_analysis', file: '010_advanced_analysis.sql' },
  { version: 11, name: 'indexing_history_skips', file: 'inline:011_indexing_history_skips' },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const resolveAuditDir = (workspaceRoot: string): string => path.join(workspaceRoot, 'state', 'audits', 'librarian', 'migrations');
const resolveBackupDir = (workspaceRoot: string, fromVersion: number): string =>
  path.join(workspaceRoot, `.librarian.backup.v${fromVersion}.${Date.now()}.${randomUUID()}`);
const hasMetadataTable = (db: Database.Database): boolean => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='librarian_metadata'").get());
const hashSql = (sql: string): string => createHash('sha256').update(sql).digest('hex');
const loadMigrationSql = async (file: string): Promise<string> => {
  if (file.startsWith('inline:')) {
    const key = file.slice('inline:'.length);
    const sql = INLINE_MIGRATIONS[key];
    if (!sql) throw new Error(`Missing inline migration: ${key}`);
    return sql;
  }
  return fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
};

const readSchemaVersion = (db: Database.Database): number => {
  if (!hasMetadataTable(db)) return 0;
  const row = db.prepare('SELECT value FROM librarian_metadata WHERE key = ?').get('schema_version') as { value?: string } | undefined;
  const parsed = Number.parseInt(row?.value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const writeSchemaVersion = (db: Database.Database, version: number): void => {
  db.prepare('INSERT INTO librarian_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('schema_version', String(version));
};

async function writeMigrationReport(workspaceRoot: string, report: LibrarianSchemaMigrationReportV1): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-');
  const dir = path.join(resolveAuditDir(workspaceRoot), timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'LibrarianSchemaMigrationReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}

async function backupLibrarianState(workspaceRoot: string, fromVersion: number): Promise<string | null> {
  const librarianDir = path.join(workspaceRoot, '.librarian');
  try {
    const stat = await fs.stat(librarianDir);
    if (!stat.isDirectory()) return noResult();
  } catch {
    return noResult();
  }
  const backupDir = resolveBackupDir(workspaceRoot, fromVersion);
  await fs.cp(librarianDir, backupDir, { recursive: true, force: false, errorOnExist: true });
  return backupDir;
}

export async function applyMigrations(db: Database.Database, workspaceRoot?: string): Promise<LibrarianSchemaMigrationReportV1 | null> {
  const fromVersion = readSchemaVersion(db);
  if (fromVersion > SCHEMA_VERSION) {
    throw new Error(
      `Schema version ${fromVersion} is newer than librainian ${LIBRARIAN_VERSION.string} supports. Upgrade librainian.`
    );
  }
  const pending = MIGRATIONS.filter((migration) => migration.version > fromVersion);
  if (!pending.length) return noResult();
  let backupPath: string | null = null;
  if (workspaceRoot) {
    backupPath = await backupLibrarianState(workspaceRoot, fromVersion);
  }
  const applied: AppliedMigration[] = [];
  try {
    for (const migration of pending) {
      const sql = await loadMigrationSql(migration.file);
      db.exec(sql);
      writeSchemaVersion(db, migration.version);
      applied.push({ version: migration.version, name: migration.name, checksum: hashSql(sql) });
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const backupHint = backupPath
      ? `Pre-migration backup preserved at ${backupPath}.`
      : 'No backup was available; run `librarian bootstrap --force` to rebuild.';
    throw new Error(`Schema migration failed: ${baseMessage}. ${backupHint}`);
  }
  if (!workspaceRoot) return noResult();
  const report: LibrarianSchemaMigrationReportV1 = {
    kind: 'LibrarianSchemaMigrationReport.v1',
    schema_version: 1,
    created_at: new Date().toISOString(),
    canon: await computeCanonRef(workspaceRoot),
    environment: computeEnvironmentRef(),
    workspace: workspaceRoot,
    from_version: fromVersion,
    to_version: pending[pending.length - 1].version,
    applied,
  };
  await writeMigrationReport(workspaceRoot, report);
  return report;
}
