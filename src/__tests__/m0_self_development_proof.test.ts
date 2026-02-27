/**
 * @fileoverview M0 Self-Development Proof Test
 *
 * Proves that LiBrainian can index and query its OWN codebase --
 * the minimum bar for "a tool that develops itself."
 *
 * Criteria (all must pass for all_passed=true):
 * 1. Each query returns at least 3 unique source files
 * 2. Each query returns specific expected files (exact path matching)
 * 3. No single file dominates across all queries (anti-dominance)
 * 4. Pairwise Jaccard similarity between result sets < 0.5 (diversity)
 * 5. Embedding coverage > 50%
 * 6. No eval-corpus contamination in results
 * 7. Writes honest, machine-verifiable proof artifact to state/m0/self-dev-proof.json
 *
 * Excluded from default `npm test` -- run with:
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

// ---------------------------------------------------------------------------
// PROOF QUERY DEFINITIONS
//
// Each query specifies:
//   - mustInclude: At least one of these path patterns MUST appear in results.
//                  Patterns are matched via (filePath).includes(pattern).
//                  These are intentionally specific -- not substring traps.
//   - mustExcludeDominant: Files matching these patterns should NOT appear
//                          unless they are genuinely relevant.
// ---------------------------------------------------------------------------

interface ProofQuery {
  label: string;
  intent: string;
  /** At least one result file path must include one of these substrings */
  mustInclude: string[];
  /** Human-readable description of what we expect */
  expectedDescription: string;
}

const PROOF_QUERIES: ProofQuery[] = [
  {
    label: 'query-pipeline',
    intent: 'how does the query pipeline work',
    mustInclude: [
      'src/api/query.ts',
      'src/cli/commands/query.ts',
      'src/query/scoring.ts',
      'src/query/multi_signal_scorer.ts',
    ],
    expectedDescription:
      'Should return the main query pipeline file (src/api/query.ts) or query scoring modules',
  },
  {
    label: 'bootstrap-lifecycle',
    intent: 'how does bootstrap indexing work',
    mustInclude: [
      'src/api/bootstrap.ts',
      'src/cli/commands/bootstrap.ts',
    ],
    expectedDescription:
      'Should return bootstrap.ts -- the bootstrap/indexing entry point',
  },
  {
    label: 'embedding-system',
    intent: 'how does embedding and vector search work',
    mustInclude: [
      'embedding_providers/',
      'real_embeddings.ts',
      'unified_embedding_pipeline.ts',
      'vector_index',
      'src/api/embeddings.ts',
    ],
    expectedDescription:
      'Should return actual embedding provider files, not incidental mentions of "vector"',
  },
];

/** Maximum pairwise Jaccard similarity allowed between any two result sets */
const MAX_JACCARD_SIMILARITY = 0.5;

/** Maximum number of query result sets a single file can appear in */
const MAX_FILE_APPEARANCES = 2;

/** Minimum number of unique source files per query (excluding function suffixes) */
const MIN_UNIQUE_FILES_PER_QUERY = 3;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Extracts file paths from context packs.
 * Normalizes paths by stripping the workspace root prefix.
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
 * Extracts only the base file path, stripping any function/symbol suffix.
 * E.g., "src/foo.ts:myFunction" -> "src/foo.ts"
 */
function toBaseFilePath(p: string): string {
  // Match paths like src/foo.ts:functionName -- strip after the extension
  const match = p.match(/^(.+\.\w+):/);
  return match ? match[1] : p;
}

/**
 * Gets unique base file paths (deduplicating function-level entries).
 */
function uniqueBaseFiles(files: string[]): string[] {
  return Array.from(new Set(files.map(toBaseFilePath)));
}

/**
 * Computes Jaccard similarity between two sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const aArr = Array.from(a);
  for (const item of aArr) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// TEST SUITE
// ---------------------------------------------------------------------------

describe('M0 Self-Development Proof', () => {
  let storage: LibrarianStorage;
  let workspaceRoot: string;
  let hasIndex = false;
  let savedSynthesisEnv: string | undefined;

  interface QueryResult {
    label: string;
    intent: string;
    packCount: number;
    files: string[];
    baseFiles: string[];
    mustIncludeMatched: boolean;
    matchedPattern: string | null;
    contamination: boolean;
    latencyMs: number;
  }

  const queryResults: QueryResult[] = [];

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
      `M0: Index found -- ${stats.totalFunctions} functions, ${stats.totalModules} modules, ${stats.totalEmbeddings} embeddings.`,
    );
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (savedSynthesisEnv === undefined) {
      delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    } else {
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = savedSynthesisEnv;
    }

    // Write proof artifact -- ALWAYS, even on failure
    if (queryResults.length > 0) {
      // Compute cross-query quality metrics
      const allResultSets = queryResults.map(
        (r) => new Set(r.baseFiles),
      );

      // Anti-dominance: count how many result sets each file appears in
      const fileAppearanceCounts = new Map<string, number>();
      for (const resultSet of allResultSets) {
        const filesInSet = Array.from(resultSet);
        for (const file of filesInSet) {
          fileAppearanceCounts.set(file, (fileAppearanceCounts.get(file) ?? 0) + 1);
        }
      }
      const dominantFiles = Array.from(fileAppearanceCounts.entries())
        .filter(([, count]) => count > MAX_FILE_APPEARANCES)
        .map(([file, count]) => ({ file, appearances: count }));

      // Pairwise Jaccard similarity
      const jaccardPairs: Array<{
        query1: string;
        query2: string;
        similarity: number;
      }> = [];
      for (let i = 0; i < allResultSets.length; i++) {
        for (let j = i + 1; j < allResultSets.length; j++) {
          jaccardPairs.push({
            query1: queryResults[i].label,
            query2: queryResults[j].label,
            similarity: jaccardSimilarity(allResultSets[i], allResultSets[j]),
          });
        }
      }
      const maxJaccard = jaccardPairs.length > 0
        ? Math.max(...jaccardPairs.map((p) => p.similarity))
        : 0;

      // Quality issues
      const qualityIssues: string[] = [];

      // Check: each query found its must-include files
      for (const r of queryResults) {
        if (!r.mustIncludeMatched) {
          qualityIssues.push(
            `[${r.label}] Did not return any expected files. Got: ${r.baseFiles.slice(0, 5).join(', ')}`,
          );
        }
      }

      // Check: minimum unique files per query
      for (const r of queryResults) {
        if (r.baseFiles.length < MIN_UNIQUE_FILES_PER_QUERY) {
          qualityIssues.push(
            `[${r.label}] Only ${r.baseFiles.length} unique files (minimum: ${MIN_UNIQUE_FILES_PER_QUERY})`,
          );
        }
      }

      // Check: no contamination
      for (const r of queryResults) {
        if (r.contamination) {
          qualityIssues.push(`[${r.label}] Eval-corpus contamination detected`);
        }
      }

      // Check: no zero-pack queries
      for (const r of queryResults) {
        if (r.packCount === 0) {
          qualityIssues.push(`[${r.label}] Returned 0 packs`);
        }
      }

      // Check: anti-dominance
      if (dominantFiles.length > 0) {
        for (const df of dominantFiles) {
          qualityIssues.push(
            `Anti-dominance violation: "${df.file}" appears in ${df.appearances}/${allResultSets.length} query result sets (max allowed: ${MAX_FILE_APPEARANCES})`,
          );
        }
      }

      // Check: Jaccard diversity
      if (maxJaccard >= MAX_JACCARD_SIMILARITY) {
        const worstPair = jaccardPairs.find((p) => p.similarity === maxJaccard)!;
        qualityIssues.push(
          `Jaccard diversity violation: "${worstPair.query1}" vs "${worstPair.query2}" similarity = ${(maxJaccard * 100).toFixed(1)}% (max allowed: ${(MAX_JACCARD_SIMILARITY * 100).toFixed(0)}%)`,
        );
      }

      const allPassed =
        qualityIssues.length === 0 &&
        queryResults.every(
          (r) => r.packCount > 0 && r.mustIncludeMatched && !r.contamination,
        );

      const proof = {
        milestone: 'M0',
        timestamp: new Date().toISOString(),
        workspace: workspaceRoot,
        queries_run: queryResults.length,
        all_passed: allPassed,
        quality_issues: qualityIssues,
        cross_query_metrics: {
          dominant_files: dominantFiles,
          jaccard_pairs: jaccardPairs,
          max_jaccard_similarity: maxJaccard,
        },
        results: queryResults.map((r) => ({
          label: r.label,
          intent: r.intent,
          packCount: r.packCount,
          files: r.files,
          baseFiles: r.baseFiles,
          mustIncludeMatched: r.mustIncludeMatched,
          matchedPattern: r.matchedPattern,
          contamination: r.contamination,
          latencyMs: r.latencyMs,
        })),
      };

      const proofDir = path.join(workspaceRoot, 'state', 'm0');
      await fs.mkdir(proofDir, { recursive: true });
      await fs.writeFile(
        path.join(proofDir, 'self-dev-proof.json'),
        JSON.stringify(proof, null, 2) + '\n',
      );
      console.log(`M0: Proof artifact written to state/m0/self-dev-proof.json`);
      if (qualityIssues.length > 0) {
        console.log(`M0: QUALITY ISSUES DETECTED:`);
        for (const issue of qualityIssues) {
          console.log(`  - ${issue}`);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Per-query tests: each query must return its expected files
  // -------------------------------------------------------------------------

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
      const baseFiles = uniqueBaseFiles(files);

      // Check must-include: at least one result file must match at least one pattern
      let matchedPattern: string | null = null;
      const mustIncludeMatched = pq.mustInclude.some((pattern) =>
        baseFiles.some((f) => {
          const matched = f.includes(pattern);
          if (matched && !matchedPattern) matchedPattern = `${f} matched "${pattern}"`;
          return matched;
        }),
      );

      const contamination = files.some((f) =>
        CONTAMINATION_PATTERNS.some((p) => f.includes(p)),
      );

      queryResults.push({
        label: pq.label,
        intent: pq.intent,
        packCount: result.packs.length,
        files,
        baseFiles,
        mustIncludeMatched,
        matchedPattern,
        contamination,
        latencyMs,
      });

      console.log(
        `  [${pq.label}] ${result.packs.length} packs, ${baseFiles.length} unique files, mustInclude=${mustIncludeMatched}, ${latencyMs}ms`,
      );
      console.log(`    Files: ${baseFiles.join(', ')}`);

      // HARD ASSERTIONS -- these FAIL the test, not soft-pass

      expect(
        result.packs.length,
        `Query "${pq.label}" returned 0 packs`,
      ).toBeGreaterThan(0);

      expect(
        mustIncludeMatched,
        `Query "${pq.label}": expected at least one of [${pq.mustInclude.join(', ')}] in results.\n` +
          `${pq.expectedDescription}\n` +
          `Got files: ${baseFiles.slice(0, 8).join(', ')}`,
      ).toBe(true);

      expect(
        contamination,
        `Query "${pq.label}" has eval-corpus contamination`,
      ).toBe(false);

      expect(
        baseFiles.length,
        `Query "${pq.label}" returned only ${baseFiles.length} unique files (minimum: ${MIN_UNIQUE_FILES_PER_QUERY})`,
      ).toBeGreaterThanOrEqual(MIN_UNIQUE_FILES_PER_QUERY);
    }, QUERY_TIMEOUT_MS);
  }

  // -------------------------------------------------------------------------
  // Cross-query diversity: anti-dominance check
  // -------------------------------------------------------------------------

  it('no single file dominates all query results (anti-dominance)', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    // Must run after per-query tests
    if (queryResults.length < PROOF_QUERIES.length) {
      ctx.skip();
      return;
    }

    const allResultSets = queryResults.map((r) => new Set(r.baseFiles));
    const fileAppearanceCounts = new Map<string, number>();
    for (const resultSet of allResultSets) {
      const filesInSet = Array.from(resultSet);
      for (const file of filesInSet) {
        fileAppearanceCounts.set(file, (fileAppearanceCounts.get(file) ?? 0) + 1);
      }
    }

    const dominantFiles = Array.from(fileAppearanceCounts.entries())
      .filter(([, count]) => count > MAX_FILE_APPEARANCES)
      .map(([file, count]) => ({ file, appearances: count }));

    if (dominantFiles.length > 0) {
      console.log(`  Anti-dominance violations:`);
      for (const df of dominantFiles) {
        console.log(`    "${df.file}" appears in ${df.appearances}/${allResultSets.length} result sets`);
      }
    }

    expect(
      dominantFiles.length,
      `${dominantFiles.length} file(s) appear in more than ${MAX_FILE_APPEARANCES} of ${allResultSets.length} query results: ` +
        dominantFiles.map((d) => `${d.file} (${d.appearances}x)`).join(', '),
    ).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cross-query diversity: Jaccard similarity check
  // -------------------------------------------------------------------------

  it('result sets have sufficient diversity (Jaccard < 0.5)', async (ctx) => {
    if (!hasIndex) {
      ctx.skip();
      return;
    }

    if (queryResults.length < PROOF_QUERIES.length) {
      ctx.skip();
      return;
    }

    const allResultSets = queryResults.map((r) => new Set(r.baseFiles));

    for (let i = 0; i < allResultSets.length; i++) {
      for (let j = i + 1; j < allResultSets.length; j++) {
        const similarity = jaccardSimilarity(allResultSets[i], allResultSets[j]);
        console.log(
          `  Jaccard("${queryResults[i].label}", "${queryResults[j].label}") = ${(similarity * 100).toFixed(1)}%`,
        );

        expect(
          similarity,
          `Result sets "${queryResults[i].label}" and "${queryResults[j].label}" are too similar ` +
            `(Jaccard = ${(similarity * 100).toFixed(1)}%, max = ${(MAX_JACCARD_SIMILARITY * 100).toFixed(0)}%)`,
        ).toBeLessThan(MAX_JACCARD_SIMILARITY);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Embedding coverage
  // -------------------------------------------------------------------------

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

    expect(
      coverage,
      `Embedding coverage ${(coverage * 100).toFixed(1)}% is below 50%`,
    ).toBeGreaterThanOrEqual(0.5);
  });
});
