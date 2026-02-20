#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    outDir: '.librarian/packs',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--workspace' || arg === '-w') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      options.workspace = path.resolve(value);
      continue;
    }
    if (arg === '--out-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --out-dir');
      }
      i += 1;
      options.outDir = value;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (seen.has(value)) {
    throw new Error('Cannot stable-stringify circular structure');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
  }
  const record = value;
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`);
  return `{${entries.join(',')}}`;
}

function sha256Hex(input) {
  return createHash('sha256').update(String(input)).digest('hex');
}

function slug(value) {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'pack';
}

function canonicalizePack(row) {
  const keyFacts = JSON.parse(row.key_facts ?? '[]');
  const codeSnippets = JSON.parse(row.code_snippets ?? '[]');
  const relatedFiles = JSON.parse(row.related_files ?? '[]');
  const invalidationTriggers = JSON.parse(row.invalidation_triggers ?? '[]');
  return {
    schemaVersion: typeof row.schema_version === 'number' ? row.schema_version : 1,
    contentHash: String(row.content_hash ?? ''),
    packType: row.pack_type,
    targetId: row.target_id,
    summary: row.summary,
    keyFacts: Array.isArray(keyFacts) ? keyFacts : [],
    codeSnippets: Array.isArray(codeSnippets) ? codeSnippets : [],
    relatedFiles: Array.isArray(relatedFiles) ? relatedFiles : [],
    invalidationTriggers: Array.isArray(invalidationTriggers) ? invalidationTriggers : [],
    confidence: row.confidence,
    versionString: row.version_string,
    createdAt: row.created_at,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = path.join(options.workspace, '.librarian', 'librarian.sqlite');
  const outDir = path.resolve(options.workspace, options.outDir);

  const db = new Database(dbPath);
  try {
    const tableInfo = db.prepare('PRAGMA table_info(librarian_context_packs)').all();
    const columnNames = new Set(tableInfo.map((column) => String(column.name)));
    if (!columnNames.has('content_hash')) {
      db.prepare("ALTER TABLE librarian_context_packs ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''").run();
    }
    if (!columnNames.has('schema_version')) {
      db.prepare('ALTER TABLE librarian_context_packs ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1').run();
    }
    const rows = db.prepare(`
      SELECT
        pack_id,
        pack_type,
        target_id,
        summary,
        key_facts,
        code_snippets,
        related_files,
        confidence,
        created_at,
        version_string,
        content_hash,
        schema_version,
        invalidation_triggers
      FROM librarian_context_packs
      ORDER BY pack_type ASC, target_id ASC
    `).all();

    await fs.mkdir(outDir, { recursive: true });
    const exports = [];
    for (const row of rows) {
      const canonical = canonicalizePack(row);
      const digestBase = canonical.contentHash || sha256Hex(stableStringify(canonical));
      const fileName = `${slug(canonical.packType)}--${slug(canonical.targetId)}--${digestBase.slice(0, 12)}.json`;
      const filePath = path.join(outDir, fileName);
      await fs.writeFile(filePath, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
      exports.push({
        file: fileName,
        packType: canonical.packType,
        targetId: canonical.targetId,
        contentHash: digestBase,
      });
    }

    const manifestPayload = {
      schema_version: 1,
      kind: 'ContextPackExportManifest.v1',
      createdAt: new Date().toISOString(),
      workspace: options.workspace,
      packCount: exports.length,
      snapshotHash: sha256Hex(stableStringify(exports)),
      packs: exports,
    };
    await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifestPayload, null, 2)}\n`, 'utf8');

    if (options.json) {
      console.log(JSON.stringify(manifestPayload, null, 2));
    } else {
      console.log(`[packs:export] exported ${exports.length} packs to ${outDir}`);
      console.log(`[packs:export] snapshot ${manifestPayload.snapshotHash}`);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('[packs:export] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
