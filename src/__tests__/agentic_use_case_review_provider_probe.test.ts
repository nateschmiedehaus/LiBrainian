import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarianResponse } from '../types.js';

const runProviderReadinessGateMock = vi.hoisted(() => vi.fn());
const ensureLibrarianReadyMock = vi.hoisted(() => vi.fn());

vi.mock('../api/provider_gate.js', () => ({
  runProviderReadinessGate: runProviderReadinessGateMock,
}));

vi.mock('../integration/first_run_gate.js', () => ({
  ensureLibrarianReady: ensureLibrarianReadyMock,
}));

import { runAgenticUseCaseReview } from '../evaluation/agentic_use_case_review.js';
import { buildPlannedUseCases } from '../evaluation/agentic_use_case_review.js';

const MATRIX = [
  '| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| UC-001 | Orientation | Locate entrypoint | none | ... | ... | planned |',
].join('\n');

const DISTRIBUTION_MATRIX = [
  '| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| UC-001 | Orientation | Locate entrypoint | none | ... | ... | planned |',
  '| UC-002 | Orientation | Identify commands | none | ... | ... | planned |',
  '| UC-003 | Orientation | Explain module boundaries | none | ... | ... | planned |',
  '| UC-004 | Orientation | Map tests | none | ... | ... | planned |',
].join('\n');

function buildResponse(intent: string): LibrarianResponse {
  return {
    query: { intent } as LibrarianResponse['query'],
    packs: [
      {
        packId: 'pack-1',
        packType: 'function_context',
        targetId: 'target-1',
        summary: 'Entry point is well-documented and mapped.',
        keyFacts: ['Fact'],
        codeSnippets: [
          {
            filePath: 'src/index.ts',
            startLine: 1,
            endLine: 4,
            content: 'export const value = 1;',
            language: 'typescript',
          },
        ],
        relatedFiles: ['src/index.ts'],
        confidence: 0.9,
        createdAt: new Date('2026-02-26T00:00:00.000Z'),
        accessCount: 1,
        lastOutcome: 'success',
        successCount: 1,
        failureCount: 0,
        version: {
          major: 0,
          minor: 2,
          patch: 1,
          string: '0.2.1',
          qualityTier: 'full',
          indexedAt: new Date('2026-02-26T00:00:00.000Z'),
          indexerVersion: 'test',
          features: [],
        },
        invalidationTriggers: [],
      },
    ],
    disclosures: [],
    traceId: 'trace-1',
    totalConfidence: 0.9,
    cacheHit: false,
    latencyMs: 3,
    version: {
      major: 0,
      minor: 2,
      patch: 1,
      string: '0.2.1',
      qualityTier: 'full',
      indexedAt: new Date('2026-02-26T00:00:00.000Z'),
      indexerVersion: 'test',
      features: [],
    },
    drillDownHints: [],
    synthesis: {
      answer: 'Start at src/index.ts.',
      confidence: 0.9,
      citations: [{ packId: 'pack-1', content: 'src/index.ts', relevance: 0.9, file: 'src/index.ts', line: 1 }],
      keyInsights: ['insight'],
      uncertainties: [],
    },
    llmRequirement: 'required',
    llmAvailable: true,
  };
}

async function prepareWorkspace(): Promise<{ root: string; reposRoot: string; matrixPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-use-case-provider-probe-'));
  const reposRoot = path.join(root, 'repos');
  const matrixPath = path.join(root, 'USE_CASE_MATRIX.md');
  await mkdir(reposRoot, { recursive: true });
  await mkdir(path.join(reposRoot, 'repo-a'), { recursive: true });
  await writeFile(
    path.join(reposRoot, 'manifest.json'),
    JSON.stringify({ repos: [{ name: 'repo-a' }] }, null, 2),
    'utf8',
  );
  await writeFile(matrixPath, MATRIX, 'utf8');
  return { root, reposRoot, matrixPath };
}

async function prepareDistributionWorkspace(): Promise<{ root: string; reposRoot: string; matrixPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-use-case-distribution-'));
  const reposRoot = path.join(root, 'repos');
  const matrixPath = path.join(root, 'USE_CASE_MATRIX.md');
  await mkdir(reposRoot, { recursive: true });
  await mkdir(path.join(reposRoot, 'repo-a'), { recursive: true });
  await mkdir(path.join(reposRoot, 'repo-b'), { recursive: true });
  await writeFile(
    path.join(reposRoot, 'manifest.json'),
    JSON.stringify({ repos: [{ name: 'repo-a' }, { name: 'repo-b' }] }, null, 2),
    'utf8',
  );
  await writeFile(matrixPath, DISTRIBUTION_MATRIX, 'utf8');
  return { root, reposRoot, matrixPath };
}

describe('runAgenticUseCaseReview provider probing', () => {
  let tempRoot: string | null = null;
  const originalWorkspaceRoot = process.env.LIBRARIAN_WORKSPACE_ROOT;

  beforeEach(() => {
    runProviderReadinessGateMock.mockReset();
    ensureLibrarianReadyMock.mockReset();
    delete process.env.LIBRARIAN_WORKSPACE_ROOT;
  });

  afterEach(async () => {
    if (typeof originalWorkspaceRoot === 'string') process.env.LIBRARIAN_WORKSPACE_ROOT = originalWorkspaceRoot;
    else delete process.env.LIBRARIAN_WORKSPACE_ROOT;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('forces provider probe in release profile to avoid stale provider cache failures', async () => {
    const workspace = await prepareWorkspace();
    tempRoot = workspace.root;

    runProviderReadinessGateMock.mockResolvedValue({
      ready: true,
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'codex',
      reason: undefined,
      embedding: { available: true, provider: 'xenova' },
    });
    ensureLibrarianReadyMock.mockResolvedValue({
      librarian: {
        queryRequired: vi.fn().mockResolvedValue(buildResponse('release probe test')),
        shutdown: vi.fn().mockResolvedValue(undefined),
      },
    });

    const report = await runAgenticUseCaseReview({
      reposRoot: workspace.reposRoot,
      matrixPath: workspace.matrixPath,
      evidenceProfile: 'release',
      maxRepos: 1,
      maxUseCases: 1,
      explorationIntentsPerRepo: 0,
      progressivePrerequisites: false,
      deterministicQueries: true,
      initTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
    });

    expect(runProviderReadinessGateMock).toHaveBeenCalledTimes(1);
    expect(runProviderReadinessGateMock.mock.calls[0]?.[1]).toMatchObject({
      emitReport: true,
      forceProbe: true,
    });
    expect(ensureLibrarianReadyMock).toHaveBeenCalledTimes(1);
    expect(ensureLibrarianReadyMock.mock.calls[0]?.[1]).toMatchObject({
      allowDegradedEmbeddings: false,
      requireCompleteParserCoverage: true,
      throwOnFailure: true,
    });
    expect(ensureLibrarianReadyMock.mock.calls[0]?.[1]).not.toHaveProperty('skipLlm');
    expect(report.options.forceProviderProbe).toBe(true);
  });

  it('scopes LIBRARIAN_WORKSPACE_ROOT to the reviewed repo during provider gate and queries', async () => {
    const workspace = await prepareWorkspace();
    tempRoot = workspace.root;
    const repoRoot = path.join(workspace.reposRoot, 'repo-a');
    process.env.LIBRARIAN_WORKSPACE_ROOT = '/tmp/original-root';

    runProviderReadinessGateMock.mockImplementation(async (root: string) => {
      expect(root).toBe(repoRoot);
      expect(process.env.LIBRARIAN_WORKSPACE_ROOT).toBe(repoRoot);
      return {
        ready: true,
        llmReady: true,
        embeddingReady: true,
        selectedProvider: 'codex',
        reason: undefined,
        embedding: { available: true, provider: 'xenova' },
      };
    });
    ensureLibrarianReadyMock.mockImplementation(async (root: string) => {
      expect(root).toBe(repoRoot);
      expect(process.env.LIBRARIAN_WORKSPACE_ROOT).toBe(repoRoot);
      return {
        librarian: {
          queryRequired: vi.fn().mockImplementation(async () => {
            expect(process.env.LIBRARIAN_WORKSPACE_ROOT).toBe(repoRoot);
            return buildResponse('scoped workspace root');
          }),
          shutdown: vi.fn().mockResolvedValue(undefined),
        },
      };
    });

    await runAgenticUseCaseReview({
      reposRoot: workspace.reposRoot,
      matrixPath: workspace.matrixPath,
      evidenceProfile: 'release',
      maxRepos: 1,
      maxUseCases: 1,
      explorationIntentsPerRepo: 0,
      progressivePrerequisites: false,
      deterministicQueries: true,
      initTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
    });

    expect(process.env.LIBRARIAN_WORKSPACE_ROOT).toBe('/tmp/original-root');
  });

  it('does not force-disable LLM initialization after a ready provider gate succeeds', async () => {
    const workspace = await prepareWorkspace();
    tempRoot = workspace.root;

    runProviderReadinessGateMock.mockResolvedValue({
      ready: true,
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'codex',
      reason: undefined,
      embedding: { available: true, provider: 'xenova' },
    });
    ensureLibrarianReadyMock.mockResolvedValue({
      librarian: {
        queryRequired: vi.fn().mockResolvedValue(buildResponse('release provider contract')),
        shutdown: vi.fn().mockResolvedValue(undefined),
      },
    });

    await runAgenticUseCaseReview({
      reposRoot: workspace.reposRoot,
      matrixPath: workspace.matrixPath,
      evidenceProfile: 'release',
      maxRepos: 1,
      maxUseCases: 1,
      explorationIntentsPerRepo: 0,
      progressivePrerequisites: false,
      deterministicQueries: true,
      initTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
    });

    expect(ensureLibrarianReadyMock).toHaveBeenCalledTimes(1);
    expect(ensureLibrarianReadyMock.mock.calls[0]?.[1]).toMatchObject({
      allowDegradedEmbeddings: false,
      requireCompleteParserCoverage: true,
      throwOnFailure: true,
    });
    expect(ensureLibrarianReadyMock.mock.calls[0]?.[1]).not.toHaveProperty('skipLlm');
  });

  it('keeps probe-forcing off for quick profile unless explicitly requested', async () => {
    const workspace = await prepareWorkspace();
    tempRoot = workspace.root;

    runProviderReadinessGateMock.mockResolvedValue({
      ready: true,
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'codex',
      reason: undefined,
      embedding: { available: true, provider: 'xenova' },
    });
    ensureLibrarianReadyMock.mockResolvedValue({
      librarian: {
        queryRequired: vi.fn().mockResolvedValue(buildResponse('quick probe test')),
        shutdown: vi.fn().mockResolvedValue(undefined),
      },
    });

    const report = await runAgenticUseCaseReview({
      reposRoot: workspace.reposRoot,
      matrixPath: workspace.matrixPath,
      evidenceProfile: 'quick',
      maxRepos: 1,
      maxUseCases: 1,
      explorationIntentsPerRepo: 0,
      progressivePrerequisites: false,
      deterministicQueries: true,
      initTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
    });

    expect(runProviderReadinessGateMock).toHaveBeenCalledTimes(1);
    expect(runProviderReadinessGateMock.mock.calls[0]?.[1]).toMatchObject({
      emitReport: true,
      forceProbe: false,
    });
    expect(ensureLibrarianReadyMock).toHaveBeenCalledTimes(1);
    expect(ensureLibrarianReadyMock.mock.calls[0]?.[1]).toMatchObject({
      allowDegradedEmbeddings: false,
      requireCompleteParserCoverage: true,
      throwOnFailure: true,
    });
    expect(ensureLibrarianReadyMock.mock.calls[0]?.[1]).not.toHaveProperty('skipLlm');
    expect(report.options.forceProviderProbe).toBe(false);
  });

  it('retries one transient init-time storage lock before failing the repo', async () => {
    const workspace = await prepareWorkspace();
    tempRoot = workspace.root;

    runProviderReadinessGateMock.mockResolvedValue({
      ready: true,
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'codex',
      reason: undefined,
      embedding: { available: true, provider: 'xenova' },
    });
    ensureLibrarianReadyMock
      .mockRejectedValueOnce(new Error('storage_locked:indexing in progress (pid=1234, startedAt=2026-03-20T22:26:35.140Z)'))
      .mockResolvedValueOnce({
        librarian: {
          queryRequired: vi.fn().mockResolvedValue(buildResponse('lock retry succeeded')),
          shutdown: vi.fn().mockResolvedValue(undefined),
        },
      });

    const report = await runAgenticUseCaseReview({
      reposRoot: workspace.reposRoot,
      matrixPath: workspace.matrixPath,
      evidenceProfile: 'release',
      maxRepos: 1,
      maxUseCases: 1,
      explorationIntentsPerRepo: 0,
      progressivePrerequisites: false,
      deterministicQueries: true,
      initTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
    });

    expect(ensureLibrarianReadyMock).toHaveBeenCalledTimes(2);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.success).toBe(true);
  });

  it('distributes selected use cases across repos instead of replaying the full set per repo', async () => {
    const workspace = await prepareDistributionWorkspace();
    tempRoot = workspace.root;

    runProviderReadinessGateMock.mockResolvedValue({
      ready: true,
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'codex',
      reason: undefined,
      embedding: { available: true, provider: 'xenova' },
    });
    ensureLibrarianReadyMock.mockImplementation(async () => ({
      librarian: {
        queryRequired: vi.fn().mockResolvedValue(buildResponse('distribution test')),
        shutdown: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const report = await runAgenticUseCaseReview({
      reposRoot: workspace.reposRoot,
      matrixPath: workspace.matrixPath,
      evidenceProfile: 'release',
      maxRepos: 2,
      maxUseCases: 4,
      selectionMode: 'sequential',
      explorationIntentsPerRepo: 0,
      progressivePrerequisites: false,
      deterministicQueries: true,
      initTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
    });

    expect(report.options.maxRunsPerRepo).toBe(2);
    expect(report.results).toHaveLength(4);
    expect(report.results.filter((result) => result.repo === 'repo-a')).toHaveLength(2);
    expect(report.results.filter((result) => result.repo === 'repo-b')).toHaveLength(2);
  });

  it('orders selected use cases after their selected prerequisites even when IDs are higher', () => {
    const planned = buildPlannedUseCases([
      { id: 'UC-045', domain: 'Impact', need: 'Determine data migration requirements', dependencies: ['UC-061'] },
      { id: 'UC-061', domain: 'Data', need: 'Identify schema sources and versions', dependencies: ['UC-007'] },
      { id: 'UC-007', domain: 'Orientation', need: 'Identify data stores and schema locations', dependencies: ['UC-001'] },
      { id: 'UC-001', domain: 'Orientation', need: 'Inventory files, languages, build tools', dependencies: [] },
    ], true);

    expect(planned.map((item) => item.id)).toEqual(['UC-001', 'UC-007', 'UC-061', 'UC-045']);
  });
});
