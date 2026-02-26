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

const MATRIX = [
  '| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| UC-001 | Orientation | Locate entrypoint | none | ... | ... | planned |',
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

describe('runAgenticUseCaseReview provider probing', () => {
  let tempRoot: string | null = null;

  beforeEach(() => {
    runProviderReadinessGateMock.mockReset();
    ensureLibrarianReadyMock.mockReset();
  });

  afterEach(async () => {
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
    expect(report.options.forceProviderProbe).toBe(true);
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
    expect(report.options.forceProviderProbe).toBe(false);
  });
});
