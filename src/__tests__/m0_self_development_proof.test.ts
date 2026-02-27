/**
 * @fileoverview M0 Self-Development Proof Test
 *
 * Proves that LiBrainian can index and query its OWN codebase —
 * the minimum bar for "a tool that develops itself."
 *
 * 1. Three domain-specific queries return relevant files
 * 2. Embedding coverage > 50% (target: 100%)
 * 3. No eval-corpus contamination in results
 * 4. Writes machine-verifiable proof artifact to state/m0/self-dev-proof.json
 *
 * Excluded from default `npm test` — run with:
 *   LIBRARIAN_T05_SMOKE=1 npm test -- --run src/__tests__/m0_self_development_proof.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { queryLibrarian } from '../api/query.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianQuery, ContextPack } from '../types.js';

const QUERY_TIMEOUT_MS = 60_000;
const SUITE_TIMEOUT_MS = 120_000;

const CONTAMINATION_PATTERNS = [
  'eval-corpus',
  '__fixtures__',
  'eval_corpus',
  'external-repos',
];

interface ProofQuery {
  label: string;
  intent: string;
  expectFiles: string[]; // at least one of these should appear in results
}

const PROOF_QUERIES: ProofQuery[] = [
  {
    label: 'query-pipeline',
    intent: 'how does the query pipeline work',
    expectFiles: ['query.ts', 'query'],
  },
  {
    label: 'bootstrap-lifecycle',
    intent: 'how does bootstrap indexing work',
    expectFiles: ['bootstrap.ts', 'bootstrap'],
  },
  {
    label: 'embedding-system',
    intent: 'how does embedding and vector search work',
    expectFiles: ['embedding', 'vector', 'hnsw'],
  },
];

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

describe('M0 Self-Development Proof', () => {
  let storage: LibrarianStorage;
  let workspaceRoot: string;
  let hasIndex = false;
  let savedSynthesisEnv: string | undefined;
  const queryResults: Array<{
    label: string;
    intent: string;
    packCount: number;
    files: string[];
    relevantFileFound: boolean;
    contamination: boolean;
    latencyMs: number;
  }> = [];

  beforeAll(async () => {
    workspaceRoot = path.resolve(__dirname, '../../');

    const librarianDir = path.join(workspaceRoot, '.librarian');
    try {
      await fs.access(librarianDir);
    } catch {
      console.warn('M0 SKIP: No .librarian/ directory');
      return;
    }

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
        console.warn('M0 SKIP: No database file found');
        return;
      }
    }

    storage = createSqliteStorage(resolvedDbPath, workspaceRoot, { useProcessLock: false });
    await storage.initialize();

    const stats = await storage.getStats();
    hasIndex = (stats.totalFunctions + stats.totalModules) > 0;

    if (!hasIndex) {
      console.warn('M0 SKIP: Index is empty. Bootstrap first.');
      return;
    }

    savedSynthesisEnv = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

    console.log(
      `M0: Index found — ${stats.totalFunctions} functions, ${stats.totalModules} modules, ${stats.totalEmbeddings} embeddings.`,
    );
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (savedSynthesisEnv === undefined) {
      delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    } else {
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = savedSynthesisEnv;
    }

    // Write proof artifact
    if (queryResults.length > 0) {
      const proof = {
        milestone: 'M0',
        timestamp: new Date().toISOString(),
        workspace: workspaceRoot,
        queries_run: queryResults.length,
        all_passed: queryResults.every(
          (r) => r.packCount > 0 && r.relevantFileFound && !r.contamination,
        ),
        results: queryResults,
      };
      const proofDir = path.join(workspaceRoot, 'state', 'm0');
      await fs.mkdir(proofDir, { recursive: true });
      await fs.writeFile(
        path.join(proofDir, 'self-dev-proof.json'),
        JSON.stringify(proof, null, 2) + '\n',
      );
      console.log(`M0: Proof artifact written to state/m0/self-dev-proof.json`);
    }
  });

  for (const pq of PROOF_QUERIES) {
    it(`query "${pq.label}" returns relevant results`, async (ctx) => {
      if (!hasIndex) {
        ctx.skip();
        return;
      }

      const query: LibrarianQuery = {
        intent: pq.intent,
        depth: 'L1',
        deterministic: true,
      };

      const start = Date.now();
      const result = await queryLibrarian(query, storage);
      const latencyMs = Date.now() - start;
      const files = extractFilePaths(result.packs, workspaceRoot);

      const relevantFileFound = pq.expectFiles.some((expected) =>
        files.some((f) => f.toLowerCase().includes(expected.toLowerCase())),
      );

      const contamination = files.some((f) =>
        CONTAMINATION_PATTERNS.some((p) => f.includes(p)),
      );

      queryResults.push({
        label: pq.label,
        intent: pq.intent,
        packCount: result.packs.length,
        files,
        relevantFileFound,
        contamination,
        latencyMs,
      });

      console.log(
        `  [${pq.label}] ${result.packs.length} packs, ${files.length} files, relevant=${relevantFileFound}, ${latencyMs}ms`,
      );

      expect(result.packs.length, `Query "${pq.label}" returned 0 packs`).toBeGreaterThan(0);
      expect(relevantFileFound, `Query "${pq.label}" did not return expected files: ${pq.expectFiles.join(', ')}. Got: ${files.slice(0, 5).join(', ')}`).toBe(true);
      expect(contamination, `Query "${pq.label}" has eval-corpus contamination`).toBe(false);
    }, QUERY_TIMEOUT_MS);
  }

  it('embedding coverage exceeds 50%', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    const stats = await storage.getStats();
    const coverage = stats.totalFunctions > 0
      ? stats.totalEmbeddings / stats.totalFunctions
      : 0;

    console.log(
      `  Embedding coverage: ${(coverage * 100).toFixed(1)}% (${stats.totalEmbeddings}/${stats.totalFunctions})`,
    );

    expect(coverage, `Embedding coverage ${(coverage * 100).toFixed(1)}% is below 50%`).toBeGreaterThanOrEqual(0.5);
  });
});
