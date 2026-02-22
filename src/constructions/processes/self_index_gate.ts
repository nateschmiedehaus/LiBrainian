import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLiBrainian } from '../../api/librarian.js';
import type { ContextPack } from '../../types.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export type SelfIndexQueryId =
  | 'construction_system_architecture'
  | 'query_pipeline'
  | 'bootstrap_flow'
  | 'mcp_server'
  | 'storage_layer';

export interface SelfIndexQuerySpec {
  id: SelfIndexQueryId;
  query: string;
  expectedFiles: string[];
}

export interface SelfIndexFixture {
  name: string;
  repoPath: string;
  queries: SelfIndexQuerySpec[];
}

export interface SelfIndexGateInput {
  fixtures?: SelfIndexFixture[];
  k?: number;
  precisionThreshold?: number;
  maxDurationMs?: number;
}

export interface SelfIndexQueryResult {
  id: SelfIndexQueryId;
  query: string;
  expectedFiles: string[];
  topFiles: string[];
  relevantHits: number;
  precisionAtK: number;
  pass: boolean;
}

export interface SelfIndexFixtureResult {
  name: string;
  repoPath: string;
  sourceTsFileCount: number;
  indexedSourceTsFileCount: number;
  bootstrapped: boolean;
  queryResults: SelfIndexQueryResult[];
  avgPrecisionAtK: number;
  constructionQueryMatched: boolean;
  queryPipelineMatched: boolean;
  pass: boolean;
  findings: string[];
  durationMs: number;
}

export interface SelfIndexGateOutput {
  kind: 'SelfIndexGateResult.v1';
  pass: boolean;
  k: number;
  precisionThreshold: number;
  fixtures: SelfIndexFixtureResult[];
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
}

const DEFAULT_K = 5;
const DEFAULT_PRECISION_THRESHOLD = 0.4;
const DEFAULT_MAX_DURATION_MS = 300_000;

const SOURCE_EXTENSIONS = new Set(['.ts']);

function normalizeFilePath(filePath: string, root: string): string {
  const normalized = filePath.replace(/\\/gu, '/');
  const normalizedRoot = root.replace(/\\/gu, '/');
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length + (normalized[normalizedRoot.length] === '/' ? 1 : 0));
  }
  return normalized;
}

function defaultQueries(): SelfIndexQuerySpec[] {
  return [
    {
      id: 'construction_system_architecture',
      query: 'construction system architecture',
      expectedFiles: ['src/constructions/'],
    },
    {
      id: 'query_pipeline',
      query: 'query pipeline',
      expectedFiles: ['src/api/query.ts', 'src/api/query_interface.ts'],
    },
    {
      id: 'bootstrap_flow',
      query: 'bootstrap pipeline initialization flow',
      expectedFiles: ['src/api/bootstrap.ts', 'src/bootstrap/'],
    },
    {
      id: 'mcp_server',
      query: 'MCP server tools and protocol handling',
      expectedFiles: ['src/mcp/server.ts'],
    },
    {
      id: 'storage_layer',
      query: 'storage layer sqlite and embeddings',
      expectedFiles: ['src/storage/'],
    },
  ];
}

function defaultFixtures(repoRoot: string): SelfIndexFixture[] {
  return [
    {
      name: 'librainian-self',
      repoPath: repoRoot,
      queries: defaultQueries(),
    },
  ];
}

async function collectSourceTsFiles(repoPath: string): Promise<string[]> {
  const srcRoot = path.join(repoPath, 'src');
  const files: string[] = [];
  try {
    await fs.access(srcRoot);
  } catch {
    return files;
  }

  const stack = [srcRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.librarian' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTENSIONS.has(extension)) {
        files.push(absolute);
      }
    }
  }
  return files;
}

function extractTopFiles(packs: ContextPack[], root: string, k: number): string[] {
  const topFiles: string[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    const candidates: string[] = [];
    for (const relatedFile of pack.relatedFiles ?? []) {
      candidates.push(relatedFile);
    }
    for (const snippet of pack.codeSnippets ?? []) {
      if (snippet.filePath) {
        candidates.push(snippet.filePath);
      }
    }
    for (const filePath of candidates) {
      const normalized = normalizeFilePath(filePath, root);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      topFiles.push(normalized);
      if (topFiles.length >= k) {
        return topFiles;
      }
    }
  }
  return topFiles;
}

function fileMatchesExpectation(filePath: string, expectation: string): boolean {
  const normalizedFile = filePath.replace(/\\/gu, '/');
  const normalizedExpectation = expectation.replace(/\\/gu, '/');
  if (normalizedExpectation.endsWith('/')) {
    return normalizedFile.startsWith(normalizedExpectation);
  }
  if (normalizedFile === normalizedExpectation) {
    return true;
  }
  return normalizedFile.endsWith(normalizedExpectation);
}

function computeQueryResult(
  query: SelfIndexQuerySpec,
  topFiles: string[],
  k: number,
  precisionThreshold: number,
): SelfIndexQueryResult {
  const relevantHits = topFiles.filter((filePath) =>
    query.expectedFiles.some((expected) => fileMatchesExpectation(filePath, expected)),
  ).length;
  const precisionAtK = relevantHits / Math.max(k, 1);
  return {
    id: query.id,
    query: query.query,
    expectedFiles: query.expectedFiles,
    topFiles,
    relevantHits,
    precisionAtK,
    pass: precisionAtK >= precisionThreshold,
  };
}

function averagePrecision(results: SelfIndexQueryResult[]): number {
  if (results.length === 0) return 0;
  const total = results.reduce((sum, result) => sum + result.precisionAtK, 0);
  return total / results.length;
}

export function createSelfIndexGateConstruction(): Construction<
  SelfIndexGateInput,
  SelfIndexGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'self-index-gate',
    name: 'Self-Index Gate',
    description: 'Bootstraps LiBrainian on itself and validates self-referential retrieval quality.',
    async execute(input: SelfIndexGateInput = {}) {
      const startedAt = Date.now();
      const repoRoot = process.cwd();
      const fixtures = input.fixtures ?? defaultFixtures(repoRoot);
      const k = input.k ?? DEFAULT_K;
      const precisionThreshold = input.precisionThreshold ?? DEFAULT_PRECISION_THRESHOLD;
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const findings: string[] = [];
      const fixtureResults: SelfIndexFixtureResult[] = [];

      for (const fixture of fixtures) {
        const fixtureStartedAt = Date.now();
        const fixtureFindings: string[] = [];
        const sourceFiles = await collectSourceTsFiles(fixture.repoPath);
        let indexedSourceTsFileCount = 0;
        let bootstrapped = false;
        const queryResults: SelfIndexQueryResult[] = [];

        const librarian = await createLiBrainian({
          workspace: fixture.repoPath,
          autoBootstrap: true,
          autoWatch: false,
          skipEmbeddings: false,
        });

        try {
          const status = await librarian.getStatus();
          bootstrapped = status.bootstrapped && status.initialized;
          if (!bootstrapped) {
            fixtureFindings.push('bootstrap failed: status did not report initialized+bootstrapped');
          }

          const storage = librarian.getStorage();
          if (!storage) {
            fixtureFindings.push('storage unavailable after bootstrap');
          } else {
            const indexedFiles = await storage.getFiles();
            indexedSourceTsFileCount = indexedFiles
              .map((file) => normalizeFilePath(file.path, fixture.repoPath))
              .filter((file) => file.startsWith('src/') && file.endsWith('.ts'))
              .length;
          }

          if (indexedSourceTsFileCount < sourceFiles.length) {
            fixtureFindings.push(
              `indexed source files below expected: expected ${sourceFiles.length}, got ${indexedSourceTsFileCount}`,
            );
          }

          for (const query of fixture.queries) {
            const response = await librarian.queryOptional({
              intent: query.query,
              depth: 'L1',
              llmRequirement: 'disabled',
              deterministic: true,
              timeoutMs: 45_000,
            });
            const topFiles = extractTopFiles(response.packs, fixture.repoPath, k);
            const result = computeQueryResult(query, topFiles, k, precisionThreshold);
            queryResults.push(result);
            if (!result.pass) {
              fixtureFindings.push(
                `${query.id}: precision@${k} ${result.precisionAtK.toFixed(2)} below threshold ${precisionThreshold.toFixed(2)}`,
              );
            }
          }
        } finally {
          await librarian.shutdown();
        }

        const constructionQuery = queryResults.find((result) => result.id === 'construction_system_architecture');
        const constructionQueryMatched = Boolean(
          constructionQuery?.topFiles.some((filePath) => filePath.startsWith('src/constructions/')),
        );
        if (!constructionQueryMatched) {
          fixtureFindings.push('construction_system_architecture did not return construction files');
        }

        const queryPipelineResult = queryResults.find((result) => result.id === 'query_pipeline');
        const queryPipelineMatched = Boolean(
          queryPipelineResult?.topFiles.some((filePath) =>
            filePath.startsWith('src/api/query') || filePath.includes('/query_pipeline'),
          ),
        );
        if (!queryPipelineMatched) {
          fixtureFindings.push('query_pipeline did not return query-related files');
        }

        const fixturePass = fixtureFindings.length === 0;
        if (!fixturePass) {
          findings.push(...fixtureFindings.map((finding) => `${fixture.name}: ${finding}`));
        }

        fixtureResults.push({
          name: fixture.name,
          repoPath: fixture.repoPath,
          sourceTsFileCount: sourceFiles.length,
          indexedSourceTsFileCount,
          bootstrapped,
          queryResults,
          avgPrecisionAtK: averagePrecision(queryResults),
          constructionQueryMatched,
          queryPipelineMatched,
          pass: fixturePass,
          findings: fixtureFindings,
          durationMs: Date.now() - fixtureStartedAt,
        });
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > maxDurationMs) {
        findings.push(`duration exceeded: ${durationMs}ms > ${maxDurationMs}ms`);
      }

      return ok<SelfIndexGateOutput, ConstructionError>({
        kind: 'SelfIndexGateResult.v1',
        pass: findings.length === 0,
        k,
        precisionThreshold,
        fixtures: fixtureResults,
        findings,
        durationMs,
        maxDurationMs,
      });
    },
  };
}
