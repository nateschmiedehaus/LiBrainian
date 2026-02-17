import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAgenticJourney } from '../evaluation/agentic_journey.js';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';
import { runProviderReadinessGate } from '../api/provider_gate.js';

vi.mock('../integration/first_run_gate.js', () => ({
  ensureLibrarianReady: vi.fn(),
}));

vi.mock('../api/provider_gate.js', () => ({
  runProviderReadinessGate: vi.fn(),
}));

describe('runAgenticJourney', () => {
  let rootDir: string;
  let reposRoot: string;
  let mockedLibrarian: {
    queryOptional: ReturnType<typeof vi.fn>;
    getGlanceCard: ReturnType<typeof vi.fn>;
    getRecommendations: ReturnType<typeof vi.fn>;
    getStorage: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'librarian-journey-'));
    reposRoot = path.join(rootDir, 'external-repos');
    await mkdir(reposRoot, { recursive: true });

    const repoRoot = path.join(reposRoot, 'repo-one');
    await mkdir(path.join(repoRoot, 'src'), { recursive: true });
    await writeFile(path.join(repoRoot, 'README.md'), '# Repo One\n');
    await writeFile(path.join(repoRoot, 'src', 'index.ts'), 'export const value = 1;\n');

    await writeFile(
      path.join(reposRoot, 'manifest.json'),
      JSON.stringify({ repos: [{ name: 'repo-one' }] }, null, 2),
      'utf8'
    );

    mockedLibrarian = {
      queryOptional: vi.fn().mockResolvedValue({
        packs: [{
          packId: 'pack-1',
          packType: 'module_context',
          targetId: 'module-1',
          summary: 'ok',
          keyFacts: [],
          codeSnippets: [],
          relatedFiles: [],
          confidence: 0.7,
          createdAt: new Date(),
          accessCount: 0,
          lastOutcome: 'success',
          successCount: 1,
          failureCount: 0,
          version: { string: '0.0.0', major: 0, minor: 0, patch: 0, qualityTier: 'mvp' },
        }],
        disclosures: [],
        query: { intent: 'x', depth: 'L1' },
        traceId: 'trace',
        totalConfidence: 0.7,
        cacheHit: false,
        latencyMs: 1,
        version: { string: '0.0.0', major: 0, minor: 0, patch: 0, qualityTier: 'mvp' },
      }),
      getGlanceCard: vi.fn().mockResolvedValue({ id: 'module-1', oneLiner: 'ok' }),
      getRecommendations: vi.fn().mockResolvedValue([]),
      getStorage: vi.fn().mockReturnValue(null),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(runProviderReadinessGate).mockResolvedValue({
      ready: true,
      providers: [
        { provider: 'claude', available: true, authenticated: true, lastCheck: Date.now() },
        { provider: 'codex', available: true, authenticated: true, lastCheck: Date.now() },
      ],
      embedding: { provider: 'xenova', available: true, lastCheck: Date.now() },
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'claude',
      bypassed: false,
    } as any);

    vi.mocked(ensureLibrarianReady).mockResolvedValue({
      success: true,
      librarian: mockedLibrarian,
      wasBootstrapped: true,
      wasUpgraded: false,
      durationMs: 10,
    } as any);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  it('runs journey over external repos and records results', async () => {
    const report = await runAgenticJourney({ reposRoot, maxRepos: 1 });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.repo).toBe('repo-one');
    expect(report.results[0]?.overviewOk).toBe(true);
    expect(report.results[0]?.glanceOk).toBe(true);
    expect(vi.mocked(ensureLibrarianReady)).toHaveBeenCalled();
    expect(vi.mocked(ensureLibrarianReady)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ allowDegradedEmbeddings: false })
    );
  });

  it('selects shell files as representative context candidates', async () => {
    const shellRoot = await mkdtemp(path.join(tmpdir(), 'librarian-journey-shell-'));
    try {
      const shellReposRoot = path.join(shellRoot, 'external-repos');
      await mkdir(shellReposRoot, { recursive: true });
      const shellRepo = path.join(shellReposRoot, 'repo-shell');
      await mkdir(shellRepo, { recursive: true });
      await writeFile(path.join(shellRepo, 'deploy.sh'), '#!/usr/bin/env bash\necho ok\n');
      await writeFile(
        path.join(shellReposRoot, 'manifest.json'),
        JSON.stringify({ repos: [{ name: 'repo-shell' }] }, null, 2),
        'utf8'
      );

      const report = await runAgenticJourney({ reposRoot: shellReposRoot, maxRepos: 1 });
      expect(report.results).toHaveLength(1);
      expect(report.results[0]?.contextFile).toBe('deploy.sh');
      expect(report.results[0]?.errors).not.toContain('no_candidate_file');
      expect(report.results[0]?.fileContextOk).toBe(true);
    } finally {
      await rm(shellRoot, { recursive: true, force: true });
    }
  });

  it('enforces strict objective mode without fallback selection', async () => {
    const report = await runAgenticJourney({
      reposRoot,
      maxRepos: 1,
      protocol: 'objective',
      strictObjective: true,
    });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.contextFile).toBeUndefined();
    expect(report.results[0]?.errors).toContain('no_retrieved_context_file');
    expect(report.results[0]?.errors).toContain('no_candidate_file');
    expect(report.results[0]?.journeyOk).toBe(false);
  });

  it('fails closed when optional LLM mode lacks provider readiness', async () => {
    vi.mocked(runProviderReadinessGate).mockResolvedValue({
      ready: false,
      providers: [
        { provider: 'claude', available: false, authenticated: false, lastCheck: Date.now(), error: 'cli_not_authenticated' },
        { provider: 'codex', available: false, authenticated: false, lastCheck: Date.now(), error: 'cli_not_authenticated' },
      ],
      embedding: { provider: 'xenova', available: true, lastCheck: Date.now() },
      llmReady: false,
      embeddingReady: true,
      selectedProvider: null,
      bypassed: false,
      reason: 'no_llm_provider_ready',
    } as any);

    const report = await runAgenticJourney({ reposRoot, maxRepos: 1, llmMode: 'optional' });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.errors.some((error) => error.includes('provider_unavailable'))).toBe(true);
    expect(vi.mocked(ensureLibrarianReady)).not.toHaveBeenCalled();
  });

  it('treats missing validation prerequisites as blocking', async () => {
    const report = await runAgenticJourney({ reposRoot, maxRepos: 1 });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.validation?.blocking).toBe(true);
    expect(report.results[0]?.errors.some((error) => error.includes('validation_unavailable'))).toBe(true);
    expect(report.results[0]?.errors).toContain('blocking_validation_failed');
    expect(report.results[0]?.journeyOk).toBe(false);
  });

  it('writes journey artifacts when artifactRoot is provided', async () => {
    const artifactRoot = path.join(rootDir, 'artifacts');
    const report = await runAgenticJourney({
      reposRoot,
      maxRepos: 1,
      artifactRoot,
      runLabel: 'test-run',
    });

    expect(report.artifacts?.root).toBeTruthy();
    expect(report.artifacts?.reportPath).toBeTruthy();
    expect(report.artifacts?.repoReportPaths.length).toBe(1);

    const runReportRaw = await readFile(report.artifacts!.reportPath, 'utf8');
    const runReport = JSON.parse(runReportRaw) as { schema: string; summary: { total: number } };
    expect(runReport.schema).toBe('AgenticJourneyRunArtifact.v1');
    expect(runReport.summary.total).toBe(1);
  });

  it('always shuts down librarian when query flow fails', async () => {
    mockedLibrarian.queryOptional.mockRejectedValueOnce(new Error('query_failed'));

    const report = await runAgenticJourney({ reposRoot, maxRepos: 1 });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.errors.some((error) => error.includes('query_failed'))).toBe(true);
    expect(mockedLibrarian.shutdown).toHaveBeenCalledTimes(1);
  });
});
