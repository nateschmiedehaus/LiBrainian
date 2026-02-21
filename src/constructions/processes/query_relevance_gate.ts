import * as path from 'node:path';
import { createLiBrainian } from '../../api/librarian.js';
import type { ContextPack } from '../../types.js';
import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface QueryRelevancePair {
  query: string;
  expectedFiles: string[];
}

export interface QueryRelevanceFixture {
  name: string;
  repoPath: string;
  pairs: QueryRelevancePair[];
}

export interface QueryRelevanceGateInput {
  fixtures?: QueryRelevanceFixture[];
  k?: number;
  precisionThreshold?: number;
}

export interface QueryRelevancePairResult {
  query: string;
  expectedFiles: string[];
  topFiles: string[];
  relevantHits: number;
  precisionAtK: number;
  pollutedByInternalFiles: boolean;
  confidenceValues: number[];
}

export interface QueryRelevanceFixtureResult {
  name: string;
  repoPath: string;
  k: number;
  precisionThreshold: number;
  pairResults: QueryRelevancePairResult[];
  avgPrecisionAtK: number;
  minPrecisionAtK: number;
  internalPollutionCount: number;
  confidenceSane: boolean;
  pass: boolean;
}

export interface QueryRelevanceGateOutput {
  kind: 'QueryRelevanceGateResult.v1';
  pass: boolean;
  k: number;
  precisionThreshold: number;
  fixtures: QueryRelevanceFixtureResult[];
  findings: string[];
  durationMs: number;
}

const DEFAULT_K = 5;
const DEFAULT_PRECISION_THRESHOLD = 0.4;

function defaultFixtures(repoRoot: string): QueryRelevanceFixture[] {
  return [
    {
      name: 'small-typescript',
      repoPath: path.join(repoRoot, 'eval-corpus/repos/small-typescript'),
      pairs: [
        { query: 'loan policy and borrowing limits', expectedFiles: ['src/policy/loanPolicy.ts'] },
        { query: 'session storage for authentication tokens', expectedFiles: ['src/auth/sessionStore.ts'] },
        { query: 'database connection and persistence', expectedFiles: ['src/data/db.ts'] },
        { query: 'overdue reporting and notifications', expectedFiles: ['src/reporting/overdueReport.ts', 'src/services/notificationService.ts'] },
        { query: 'rate limiting policy', expectedFiles: ['src/policy/rateLimiter.ts'] },
      ],
    },
    {
      name: 'medium-python',
      repoPath: path.join(repoRoot, 'eval-corpus/repos/medium-python'),
      pairs: [
        { query: 'rate limiting enforcement', expectedFiles: ['src/rate_limit.py'] },
        { query: 'authentication and token validation', expectedFiles: ['src/auth.py'] },
        { query: 'notification delivery', expectedFiles: ['src/notifications.py'] },
        { query: 'report generation', expectedFiles: ['src/reporting.py'] },
        { query: 'storage persistence layer', expectedFiles: ['src/store.py'] },
      ],
    },
  ];
}

function normalizeFilePath(filePath: string, root: string): string {
  const normalized = filePath.replace(/\\/gu, '/');
  const normalizedRoot = root.replace(/\\/gu, '/');
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length + (normalized[normalizedRoot.length] === '/' ? 1 : 0));
  }
  return normalized;
}

function extractPackFiles(pack: ContextPack, root: string): string[] {
  const files = new Set<string>();
  for (const file of pack.relatedFiles ?? []) {
    files.add(normalizeFilePath(file, root));
  }
  for (const snippet of pack.codeSnippets ?? []) {
    if (snippet?.filePath) {
      files.add(normalizeFilePath(snippet.filePath, root));
    }
  }
  return Array.from(files);
}

function collectTopFiles(packs: ContextPack[], root: string): string[] {
  const files: string[] = [];
  for (const pack of packs) {
    for (const file of extractPackFiles(pack, root)) {
      files.push(file);
    }
  }
  return files;
}

function evaluateConfidenceSanity(pairResults: QueryRelevancePairResult[]): boolean {
  const values = pairResults.flatMap((result) => result.confidenceValues);
  if (values.length === 0) return false;
  const allInRange = values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const unique = new Set(values.map((value) => value.toFixed(6)));
  return allInRange && unique.size > 1;
}

export function createQueryRelevanceGateConstruction(): Construction<
  QueryRelevanceGateInput,
  QueryRelevanceGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'query-relevance-gate',
    name: 'Query Relevance Gate',
    description: 'Runs curated query/ground-truth pairs and enforces precision and relevance quality thresholds.',
    async execute(input: QueryRelevanceGateInput = {}): Promise<QueryRelevanceGateOutput> {
      const startedAt = Date.now();
      const repoRoot = process.cwd();
      const fixtures = input.fixtures ?? defaultFixtures(repoRoot);
      const k = input.k ?? DEFAULT_K;
      const precisionThreshold = input.precisionThreshold ?? DEFAULT_PRECISION_THRESHOLD;
      const findings: string[] = [];
      const fixtureResults: QueryRelevanceFixtureResult[] = [];

      for (const fixture of fixtures) {
        const librarian = await createLiBrainian({
          workspace: fixture.repoPath,
          autoBootstrap: true,
          autoWatch: false,
          skipEmbeddings: false,
        });

        try {
          const pairResults: QueryRelevancePairResult[] = [];

          for (const pair of fixture.pairs) {
            const response = await librarian.queryOptional({
              intent: pair.query,
              depth: 'L1',
              llmRequirement: 'disabled',
              deterministic: true,
              timeoutMs: 30_000,
            });
            const topPacks = response.packs.slice(0, k);
            const topFiles = collectTopFiles(topPacks, fixture.repoPath);
            const expectedSet = new Set(pair.expectedFiles.map((file) => file.replace(/\\/gu, '/')));
            const relevantHits = topFiles.filter((file) => expectedSet.has(file)).length;
            const pollutedByInternalFiles = topFiles.some((file) => file.includes('.librarian/'));
            const confidenceValues = topPacks.map((pack) => Number(pack.confidence ?? 0));

            pairResults.push({
              query: pair.query,
              expectedFiles: pair.expectedFiles,
              topFiles,
              relevantHits,
              precisionAtK: relevantHits / Math.max(k, 1),
              pollutedByInternalFiles,
              confidenceValues,
            });
          }

          const avgPrecisionAtK =
            pairResults.reduce((sum, result) => sum + result.precisionAtK, 0) /
            Math.max(pairResults.length, 1);
          const minPrecisionAtK = pairResults.reduce(
            (min, result) => Math.min(min, result.precisionAtK),
            Number.POSITIVE_INFINITY,
          );
          const internalPollutionCount = pairResults.filter((result) => result.pollutedByInternalFiles).length;
          const confidenceSane = evaluateConfidenceSanity(pairResults);
          const precisionFailures = pairResults.filter((result) => result.precisionAtK < precisionThreshold);

          const pass =
            precisionFailures.length === 0 &&
            internalPollutionCount === 0 &&
            confidenceSane;

          if (!pass) {
            if (precisionFailures.length > 0) {
              findings.push(
                `${fixture.name}: precision@${k} below ${precisionThreshold} for ${precisionFailures.length} query pair(s)`,
              );
            }
            if (internalPollutionCount > 0) {
              findings.push(`${fixture.name}: internal file pollution detected in ${internalPollutionCount} query result(s)`);
            }
            if (!confidenceSane) {
              findings.push(`${fixture.name}: confidence score sanity check failed`);
            }
          }

          fixtureResults.push({
            name: fixture.name,
            repoPath: fixture.repoPath,
            k,
            precisionThreshold,
            pairResults,
            avgPrecisionAtK,
            minPrecisionAtK: Number.isFinite(minPrecisionAtK) ? minPrecisionAtK : 0,
            internalPollutionCount,
            confidenceSane,
            pass,
          });
        } finally {
          await librarian.shutdown();
        }
      }

      return {
        kind: 'QueryRelevanceGateResult.v1',
        pass: findings.length === 0,
        k,
        precisionThreshold,
        fixtures: fixtureResults,
        findings,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}
