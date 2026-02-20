import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export type MemoryFactSource = 'agent' | 'analysis' | 'user';
export type MemoryFactScope = 'codebase' | 'module' | 'function';

export interface MemoryFact {
  id: string;
  content: string;
  source: MemoryFactSource;
  scope: MemoryFactScope;
  scopeKey?: string;
  confidence: number;
  evergreen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryAddInput {
  content: string;
  source?: MemoryFactSource;
  scope?: MemoryFactScope;
  scopeKey?: string;
  confidence?: number;
  evergreen?: boolean;
}

export interface MemorySearchResult extends MemoryFact {
  similarity: number;
  recencyWeight: number;
  score: number;
}

export interface MemoryStoreStats {
  totalFacts: number;
  oldestFactAt: string | null;
  newestFactAt: string | null;
}

export interface MemoryAddResult {
  action: 'added' | 'updated';
  fact: MemoryFact;
}

const HALF_LIFE_DAYS = 30;
const DEDUPE_THRESHOLD = 0.5;
const MAX_CANDIDATES = 300;
const MAX_EVENTS = 5000;

function memoryDbPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), '.librarian', 'memory.db');
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(' ').filter(Boolean));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function daysSince(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, (Date.now() - parsed) / (24 * 60 * 60 * 1000));
}

function recencyWeight(updatedAt: string, evergreen: boolean): number {
  if (evergreen) return 1;
  const ageDays = daysSince(updatedAt);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function clampConfidence(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0.7;
  return Math.min(1, Math.max(0, value ?? 0.7));
}

function toFact(row: {
  id: string;
  content: string;
  source: MemoryFactSource;
  scope: MemoryFactScope;
  scope_key: string | null;
  confidence: number;
  evergreen: number;
  created_at: string;
  updated_at: string;
}): MemoryFact {
  return {
    id: row.id,
    content: row.content,
    source: row.source,
    scope: row.scope,
    scopeKey: row.scope_key ?? undefined,
    confidence: row.confidence,
    evergreen: row.evergreen === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureMemorySchema(workspaceRoot: string): Promise<string> {
  const dbPath = memoryDbPath(workspaceRoot);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        normalized_content TEXT NOT NULL,
        source TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_key TEXT,
        confidence REAL NOT NULL,
        evergreen INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_facts_scope ON memory_facts(scope, scope_key);
      CREATE INDEX IF NOT EXISTS idx_memory_facts_updated ON memory_facts(updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        previous_content TEXT,
        next_content TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_events_fact ON memory_events(fact_id, occurred_at DESC);
    `);
  } finally {
    db.close();
  }
  return dbPath;
}

function trimEvents(db: Database.Database): void {
  const total = db.prepare('SELECT COUNT(*) as count FROM memory_events').get() as { count: number };
  if (total.count <= MAX_EVENTS) return;
  const overflow = total.count - MAX_EVENTS;
  db.prepare(
    `DELETE FROM memory_events
     WHERE id IN (SELECT id FROM memory_events ORDER BY id ASC LIMIT ?)`
  ).run(overflow);
}

export async function addMemoryFact(workspaceRoot: string, input: MemoryAddInput): Promise<MemoryAddResult> {
  const content = input.content.trim();
  if (!content) {
    throw new Error('Memory content must be non-empty.');
  }
  const dbPath = await ensureMemorySchema(workspaceRoot);
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    const source: MemoryFactSource = input.source ?? 'agent';
    const scope: MemoryFactScope = input.scope ?? 'codebase';
    const scopeKey = input.scopeKey?.trim() || null;
    const confidence = clampConfidence(input.confidence);
    const evergreen = input.evergreen ? 1 : 0;
    const normalized = normalizeText(content);
    const newTokens = tokenize(content);

    const candidates = db.prepare(
      `SELECT id, content, source, scope, scope_key, confidence, evergreen, created_at, updated_at
       FROM memory_facts
       WHERE (? IS NULL OR scope_key = ?)
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(scopeKey, scopeKey, MAX_CANDIDATES) as Array<{
      id: string;
      content: string;
      source: MemoryFactSource;
      scope: MemoryFactScope;
      scope_key: string | null;
      confidence: number;
      evergreen: number;
      created_at: string;
      updated_at: string;
    }>;

    let bestCandidate: { id: string; similarity: number } | null = null;
    for (const candidate of candidates) {
      const similarity = jaccardSimilarity(newTokens, tokenize(candidate.content));
      if (similarity >= DEDUPE_THRESHOLD && (!bestCandidate || similarity > bestCandidate.similarity)) {
        bestCandidate = { id: candidate.id, similarity };
      }
    }

    if (bestCandidate) {
      const previous = db.prepare(
        `SELECT id, content, source, scope, scope_key, confidence, evergreen, created_at, updated_at
         FROM memory_facts WHERE id = ?`
      ).get(bestCandidate.id) as {
        id: string;
        content: string;
        source: MemoryFactSource;
        scope: MemoryFactScope;
        scope_key: string | null;
        confidence: number;
        evergreen: number;
        created_at: string;
        updated_at: string;
      };
      db.prepare(
        `UPDATE memory_facts
         SET content = ?, normalized_content = ?, source = ?, scope = ?, scope_key = ?, confidence = ?, evergreen = ?, updated_at = ?
         WHERE id = ?`
      ).run(content, normalized, source, scope, scopeKey, confidence, evergreen, now, bestCandidate.id);
      db.prepare(
        `INSERT INTO memory_events (fact_id, event_type, previous_content, next_content, occurred_at)
         VALUES (?, 'update', ?, ?, ?)`
      ).run(bestCandidate.id, previous.content, content, now);
      trimEvents(db);
      const fact = toFact({
        id: previous.id,
        content,
        source,
        scope,
        scope_key: scopeKey,
        confidence,
        evergreen,
        created_at: previous.created_at,
        updated_at: now,
      });
      return { action: 'updated', fact };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO memory_facts
        (id, content, normalized_content, source, scope, scope_key, confidence, evergreen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, content, normalized, source, scope, scopeKey, confidence, evergreen, now, now);
    db.prepare(
      `INSERT INTO memory_events (fact_id, event_type, previous_content, next_content, occurred_at)
       VALUES (?, 'add', NULL, ?, ?)`
    ).run(id, content, now);
    trimEvents(db);
    return {
      action: 'added',
      fact: {
        id,
        content,
        source,
        scope,
        scopeKey: scopeKey ?? undefined,
        confidence,
        evergreen: evergreen === 1,
        createdAt: now,
        updatedAt: now,
      },
    };
  } finally {
    db.close();
  }
}

export async function updateMemoryFact(workspaceRoot: string, id: string, content: string): Promise<MemoryFact> {
  const dbPath = await ensureMemorySchema(workspaceRoot);
  const db = new Database(dbPath);
  try {
    const existing = db.prepare(
      `SELECT id, content, source, scope, scope_key, confidence, evergreen, created_at, updated_at
       FROM memory_facts WHERE id = ?`
    ).get(id) as {
      id: string;
      content: string;
      source: MemoryFactSource;
      scope: MemoryFactScope;
      scope_key: string | null;
      confidence: number;
      evergreen: number;
      created_at: string;
      updated_at: string;
    } | undefined;
    if (!existing) {
      throw new Error(`Memory fact not found: ${id}`);
    }
    const nextContent = content.trim();
    if (!nextContent) {
      throw new Error('Updated memory content must be non-empty.');
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE memory_facts
       SET content = ?, normalized_content = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextContent, normalizeText(nextContent), now, id);
    db.prepare(
      `INSERT INTO memory_events (fact_id, event_type, previous_content, next_content, occurred_at)
       VALUES (?, 'update', ?, ?, ?)`
    ).run(id, existing.content, nextContent, now);
    trimEvents(db);
    return toFact({
      ...existing,
      content: nextContent,
      updated_at: now,
    });
  } finally {
    db.close();
  }
}

export async function deleteMemoryFact(workspaceRoot: string, id: string): Promise<boolean> {
  const dbPath = await ensureMemorySchema(workspaceRoot);
  const db = new Database(dbPath);
  try {
    const existing = db.prepare('SELECT id, content FROM memory_facts WHERE id = ?').get(id) as {
      id: string;
      content: string;
    } | undefined;
    if (!existing) return false;
    const now = new Date().toISOString();
    db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
    db.prepare(
      `INSERT INTO memory_events (fact_id, event_type, previous_content, next_content, occurred_at)
       VALUES (?, 'delete', ?, NULL, ?)`
    ).run(id, existing.content, now);
    trimEvents(db);
    return true;
  } finally {
    db.close();
  }
}

export async function searchMemoryFacts(
  workspaceRoot: string,
  query: string,
  options?: { limit?: number; scopeKey?: string; minScore?: number }
): Promise<MemorySearchResult[]> {
  const dbPath = await ensureMemorySchema(workspaceRoot);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const limit = Math.max(1, Math.min(200, options?.limit ?? 10));
    const minScore = Math.max(0, Math.min(1, options?.minScore ?? 0));
    const scopeKey = options?.scopeKey?.trim() || null;
    const queryTokens = tokenize(query);
    const normalizedQuery = normalizeText(query);

    const rows = db.prepare(
      `SELECT id, content, source, scope, scope_key, confidence, evergreen, created_at, updated_at
       FROM memory_facts
       WHERE (? IS NULL OR scope_key = ?)
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(scopeKey, scopeKey, MAX_CANDIDATES) as Array<{
      id: string;
      content: string;
      source: MemoryFactSource;
      scope: MemoryFactScope;
      scope_key: string | null;
      confidence: number;
      evergreen: number;
      created_at: string;
      updated_at: string;
    }>;

    const scored = rows.map((row) => {
      const similarity = normalizedQuery.length === 0
        ? 0
        : jaccardSimilarity(queryTokens, tokenize(row.content));
      const containsBonus = normalizedQuery.length > 0
        && normalizeText(row.content).includes(normalizedQuery)
        ? 0.2
        : 0;
      const recency = recencyWeight(row.updated_at, row.evergreen === 1);
      const score = Math.min(1, (similarity + containsBonus) * 0.75 + row.confidence * 0.25) * recency;
      return { row, similarity, recency, score };
    });

    return scored
      .filter((entry) => entry.score >= minScore)
      .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at))
      .slice(0, limit)
      .map((entry) => ({
        ...toFact(entry.row),
        similarity: entry.similarity,
        recencyWeight: entry.recency,
        score: entry.score,
      }));
  } finally {
    db.close();
  }
}

export async function listMemoryFacts(workspaceRoot: string, limit = 100): Promise<MemoryFact[]> {
  const dbPath = await ensureMemorySchema(workspaceRoot);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      `SELECT id, content, source, scope, scope_key, confidence, evergreen, created_at, updated_at
       FROM memory_facts
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(Math.max(1, Math.min(limit, 500))) as Array<{
      id: string;
      content: string;
      source: MemoryFactSource;
      scope: MemoryFactScope;
      scope_key: string | null;
      confidence: number;
      evergreen: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map(toFact);
  } finally {
    db.close();
  }
}

export async function getMemoryStoreStats(workspaceRoot: string): Promise<MemoryStoreStats> {
  const dbPath = await ensureMemorySchema(workspaceRoot);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(
      `SELECT COUNT(*) as totalFacts, MIN(created_at) as oldestFactAt, MAX(updated_at) as newestFactAt
       FROM memory_facts`
    ).get() as {
      totalFacts: number;
      oldestFactAt: string | null;
      newestFactAt: string | null;
    };
    return {
      totalFacts: row.totalFacts,
      oldestFactAt: row.oldestFactAt,
      newestFactAt: row.newestFactAt,
    };
  } finally {
    db.close();
  }
}
