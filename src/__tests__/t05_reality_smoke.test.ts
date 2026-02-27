/**
 * @fileoverview T0.5 Reality Smoke Test
 *
 * A 30-second test that catches failures unit tests miss by running the REAL
 * query pipeline against the LiBrainian codebase itself.
 *
 * This test uses structural/lexical retrieval only -- no embeddings or LLM
 * required. It verifies that:
 *
 * 1. Three semantically different queries each return at least 1 result
 * 2. The result sets are meaningfully different (not all returning the same files)
 * 3. No eval-corpus path contamination leaks into results
 * 4. The query pipeline completes within a reasonable time budget
 *
 * Skips gracefully when no index exists (e.g., fresh clone without bootstrap).
 *
 * Run:  npm run test:smoke
 * Tag:  This file is excluded from the default `npm test` by vitest config.
 *
 * Issue: #854
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { queryLibrarian } from '../api/query.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianQuery, ContextPack } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum wall-clock time for the entire suite (ms). */
const SUITE_TIMEOUT_MS = 30_000;

/** Maximum time for a single query (ms). */
const QUERY_TIMEOUT_MS = 15_000;

/** Minimum results each query must return. */
const MIN_RESULTS_PER_QUERY = 1;

/**
 * Maximum Jaccard similarity allowed between any two result sets.
 * 1.0 means identical sets; 0.0 means completely disjoint.
 * We require < 1.0 to prove the pipeline differentiates queries.
 */
const MAX_JACCARD_SIMILARITY = 0.99;

/** Paths that must never appear in results (eval-corpus contamination). */
const CONTAMINATION_PATTERNS = [
  'eval-corpus',
  '__fixtures__',
  'eval_corpus',
  'external-repos',
];

// ---------------------------------------------------------------------------
// Test queries -- semantically different domains
// ---------------------------------------------------------------------------

interface SmokeQuery {
  label: string;
  intent: string;
}

const SMOKE_QUERIES: SmokeQuery[] = [
  { label: 'testing', intent: 'how do tests work' },
  { label: 'storage', intent: 'how does SQLite storage work' },
  { label: 'embedding', intent: 'how does embedding work' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract unique file paths from context packs.
 * Strips the workspace-root prefix so paths are relative.
 */
function extractFilePaths(packs: ContextPack[], workspaceRoot: string): string[] {
  const pathSet = new Set<string>();
  for (const pack of packs) {
    for (const file of pack.relatedFiles ?? []) {
      pathSet.add(stripPrefix(file, workspaceRoot));
    }
    for (const snippet of pack.codeSnippets ?? []) {
      if (snippet.filePath) {
        pathSet.add(stripPrefix(snippet.filePath, workspaceRoot));
      }
    }
    // targetId often contains a file path
    if (pack.targetId && (pack.targetId.includes('/') || pack.targetId.includes('\\'))) {
      pathSet.add(stripPrefix(pack.targetId, workspaceRoot));
    }
  }
  return Array.from(pathSet);
}

function stripPrefix(p: string, prefix: string): string {
  if (p.startsWith(prefix)) {
    const stripped = p.slice(prefix.length);
    return stripped.startsWith('/') ? stripped.slice(1) : stripped;
  }
  return p;
}

/**
 * Jaccard similarity: |A intersect B| / |A union B|.
 * Returns 0 when both sets are empty (vacuously disjoint).
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersect = 0;
  for (const item of setA) {
    if (setB.has(item)) intersect++;
  }
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('T0.5 Reality Smoke', () => {
  let storage: LibrarianStorage;
  let workspaceRoot: string;
  let hasIndex = false;
  let savedSynthesisEnv: string | undefined;

  beforeAll(async () => {
    // Resolve workspace root -- two directories up from src/__tests__/
    workspaceRoot = path.resolve(__dirname, '../../');

    // Check for .librarian directory
    const librarianDir = path.join(workspaceRoot, '.librarian');
    try {
      await fs.access(librarianDir);
    } catch {
      console.warn(
        'T0.5 SKIP: No .librarian/ directory found at',
        librarianDir,
        '-- bootstrap the project first (librarian bootstrap).',
      );
      return;
    }

    // Try both .sqlite and .db paths
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const dbPath = path.join(librarianDir, 'librarian.db');
    let resolvedDbPath: string;
    try {
      await fs.access(sqlitePath);
      resolvedDbPath = sqlitePath;
    } catch {
      try {
        await fs.access(dbPath);
        resolvedDbPath = dbPath;
      } catch {
        console.warn(
          'T0.5 SKIP: No database file found at',
          sqlitePath,
          'or',
          dbPath,
        );
        return;
      }
    }

    storage = createSqliteStorage(resolvedDbPath, workspaceRoot, { useProcessLock: false });
    await storage.initialize();

    const stats = await storage.getStats();
    hasIndex = (stats.totalFunctions + stats.totalModules) > 0;

    if (!hasIndex) {
      console.warn(
        'T0.5 SKIP: Index is empty (0 functions, 0 modules). Bootstrap the project first.',
      );
      return;
    }

    // Disable LLM synthesis -- we only need structural/lexical retrieval
    savedSynthesisEnv = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

    console.log(
      `T0.5: Index found -- ${stats.totalFunctions} functions, ${stats.totalModules} modules, ${stats.totalEmbeddings} embeddings.`,
    );
  }, SUITE_TIMEOUT_MS);

  afterAll(() => {
    if (savedSynthesisEnv === undefined) {
      delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    } else {
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = savedSynthesisEnv;
    }
  });

  // -----------------------------------------------------------------------
  // Core smoke assertions
  // -----------------------------------------------------------------------

  it('each query returns at least 1 result', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    for (const sq of SMOKE_QUERIES) {
      const query: LibrarianQuery = {
        intent: sq.intent,
        depth: 'L1',
        deterministic: true,
      };

      const result = await queryLibrarian(query, storage);
      const files = extractFilePaths(result.packs, workspaceRoot);

      console.log(
        `  [${sq.label}] "${sq.intent}" => ${result.packs.length} packs, ${files.length} unique files`,
      );

      expect(
        result.packs.length,
        `Query "${sq.label}" returned 0 packs`,
      ).toBeGreaterThanOrEqual(MIN_RESULTS_PER_QUERY);
    }
  }, QUERY_TIMEOUT_MS * SMOKE_QUERIES.length);

  it('result sets are semantically different (not identical)', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    const allFiles: string[][] = [];

    for (const sq of SMOKE_QUERIES) {
      const query: LibrarianQuery = {
        intent: sq.intent,
        depth: 'L1',
        deterministic: true,
      };

      const result = await queryLibrarian(query, storage);
      allFiles.push(extractFilePaths(result.packs, workspaceRoot));
    }

    // Compare each pair
    for (let i = 0; i < allFiles.length; i++) {
      for (let j = i + 1; j < allFiles.length; j++) {
        const sim = jaccardSimilarity(allFiles[i], allFiles[j]);
        console.log(
          `  Jaccard(${SMOKE_QUERIES[i].label}, ${SMOKE_QUERIES[j].label}) = ${sim.toFixed(3)}`,
        );
        expect(
          sim,
          `Queries "${SMOKE_QUERIES[i].label}" and "${SMOKE_QUERIES[j].label}" returned identical results (Jaccard=${sim.toFixed(3)})`,
        ).toBeLessThan(MAX_JACCARD_SIMILARITY);
      }
    }
  }, QUERY_TIMEOUT_MS * SMOKE_QUERIES.length);

  it('no eval-corpus path contamination', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    for (const sq of SMOKE_QUERIES) {
      const query: LibrarianQuery = {
        intent: sq.intent,
        depth: 'L1',
        deterministic: true,
      };

      const result = await queryLibrarian(query, storage);
      const files = extractFilePaths(result.packs, workspaceRoot);

      for (const file of files) {
        for (const pattern of CONTAMINATION_PATTERNS) {
          expect(
            file,
            `Query "${sq.label}" result contains eval-corpus contamination: "${file}"`,
          ).not.toContain(pattern);
        }
      }
    }
  }, QUERY_TIMEOUT_MS * SMOKE_QUERIES.length);

  it('completes all 3 queries within the time budget', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    const start = Date.now();

    for (const sq of SMOKE_QUERIES) {
      const query: LibrarianQuery = {
        intent: sq.intent,
        depth: 'L1',
        deterministic: true,
      };
      await queryLibrarian(query, storage);
    }

    const elapsed = Date.now() - start;
    console.log(`  Total query time: ${elapsed}ms`);

    expect(
      elapsed,
      `Queries took ${elapsed}ms, exceeding ${SUITE_TIMEOUT_MS}ms budget`,
    ).toBeLessThan(SUITE_TIMEOUT_MS);
  }, SUITE_TIMEOUT_MS);
});
