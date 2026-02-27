#!/usr/bin/env node

/**
 * T0.5 Reality Smoke Test — standalone CI-friendly runner
 *
 * Runs the same checks as the vitest suite but as a plain Node script that
 * can be invoked without any test framework.  Exits 0 on success, 1 on
 * failure, and 0 with a warning when no index is available (graceful skip).
 *
 * Usage:
 *   node scripts/t05-smoke.mjs [--workspace <path>]
 *
 * Environment:
 *   LIBRARIAN_QUERY_DISABLE_SYNTHESIS=1 is set automatically.
 *
 * Issue: #854
 */

import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: resolve(__dirname, '..') },
  },
  strict: false,
});

const workspaceRoot = resolve(values.workspace);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUITE_TIMEOUT_MS = 30_000;
const MAX_JACCARD = 0.99;
const MIN_PACKS = 1;
const CONTAMINATION = ['eval-corpus', '__fixtures__', 'eval_corpus', 'external-repos'];
const QUERIES = [
  { label: 'testing', intent: 'how do tests work' },
  { label: 'storage', intent: 'how does SQLite storage work' },
  { label: 'embedding', intent: 'how does embedding work' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripPrefix(p, prefix) {
  if (p.startsWith(prefix)) {
    const s = p.slice(prefix.length);
    return s.startsWith('/') ? s.slice(1) : s;
  }
  return p;
}

function extractFilePaths(packs) {
  const out = new Set();
  for (const pack of packs) {
    for (const f of pack.relatedFiles ?? []) out.add(stripPrefix(f, workspaceRoot));
    for (const s of pack.codeSnippets ?? []) {
      if (s.filePath) out.add(stripPrefix(s.filePath, workspaceRoot));
    }
    if (pack.targetId && (pack.targetId.includes('/') || pack.targetId.includes('\\'))) {
      out.add(stripPrefix(pack.targetId, workspaceRoot));
    }
  }
  return [...out];
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size && !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`T0.5 Reality Smoke — workspace: ${workspaceRoot}`);

  // 1. Locate database
  const libDir = join(workspaceRoot, '.librarian');
  try {
    await access(libDir);
  } catch {
    console.warn('SKIP: No .librarian/ directory. Bootstrap the project first.');
    process.exit(0);
  }

  let dbPath;
  for (const name of ['librarian.sqlite', 'librarian.db']) {
    const candidate = join(libDir, name);
    try {
      await access(candidate);
      dbPath = candidate;
      break;
    } catch { /* continue */ }
  }
  if (!dbPath) {
    console.warn('SKIP: No database file found.');
    process.exit(0);
  }

  // 2. Dynamic import so the script works from the repo root via tsx/node
  const { createSqliteStorage } = await import(join(workspaceRoot, 'dist', 'storage', 'sqlite_storage.js'));
  const { queryLibrarian } = await import(join(workspaceRoot, 'dist', 'api', 'query.js'));

  const storage = createSqliteStorage(dbPath, workspaceRoot, { useProcessLock: false });
  await storage.initialize();
  const stats = await storage.getStats();

  if ((stats.totalFunctions + stats.totalModules) === 0) {
    console.warn('SKIP: Index is empty. Bootstrap the project first.');
    process.exit(0);
  }

  console.log(`Index: ${stats.totalFunctions} functions, ${stats.totalModules} modules, ${stats.totalEmbeddings} embeddings`);

  // 3. Disable synthesis
  process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

  const failures = [];
  const allFiles = [];
  const start = Date.now();

  for (const sq of QUERIES) {
    const result = await queryLibrarian(
      { intent: sq.intent, depth: 'L1', deterministic: true },
      storage,
    );
    const files = extractFilePaths(result.packs);
    allFiles.push(files);

    console.log(`  [${sq.label}] ${result.packs.length} packs, ${files.length} files`);

    // Check: at least MIN_PACKS results
    if (result.packs.length < MIN_PACKS) {
      failures.push(`Query "${sq.label}" returned ${result.packs.length} packs (need >= ${MIN_PACKS})`);
    }

    // Check: no contamination
    for (const f of files) {
      for (const pat of CONTAMINATION) {
        if (f.includes(pat)) {
          failures.push(`Query "${sq.label}" returned contaminated path: ${f}`);
        }
      }
    }
  }

  // Check: differentiation
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      const sim = jaccard(allFiles[i], allFiles[j]);
      console.log(`  Jaccard(${QUERIES[i].label}, ${QUERIES[j].label}) = ${sim.toFixed(3)}`);
      if (sim >= MAX_JACCARD) {
        failures.push(
          `Queries "${QUERIES[i].label}" and "${QUERIES[j].label}" returned identical results (Jaccard=${sim.toFixed(3)})`,
        );
      }
    }
  }

  // Check: time budget
  const elapsed = Date.now() - start;
  console.log(`  Total time: ${elapsed}ms`);
  if (elapsed >= SUITE_TIMEOUT_MS) {
    failures.push(`Queries took ${elapsed}ms, exceeding ${SUITE_TIMEOUT_MS}ms budget`);
  }

  // 4. Report
  if (failures.length > 0) {
    console.error('\nT0.5 FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('\nT0.5 PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('T0.5 ERROR:', err);
  process.exit(1);
});
