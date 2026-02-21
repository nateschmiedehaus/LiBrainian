/**
 * @fileoverview Tests for degraded-mode bootstrapping in first_run_gate.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';

let capturedConfig: Record<string, unknown> | null = null;

vi.mock('../../api/librainian.js', () => ({
  createLiBrainian: vi.fn(async (config: Record<string, unknown>) => {
    capturedConfig = config;
    return {
      isReady: () => true,
      getStatus: async () => ({ upgradeAvailable: false }),
      shutdown: async () => undefined,
    };
  }),
  LiBrainian: class {},
}));

vi.mock('../../api/provider_gate.js', () => ({
  runProviderReadinessGate: vi.fn(async () => ({
    ready: false,
    llmReady: false,
    embeddingReady: true,
    selectedProvider: null,
    providers: [
      { provider: 'claude', available: false, authenticated: false, error: 'unavailable' },
      { provider: 'codex', available: false, authenticated: false, error: 'unavailable' },
    ],
    embedding: { provider: 'xenova' },
    remediationSteps: [],
    reason: 'LLM unavailable',
  })),
}));

vi.mock('../workspace_lock.js', () => ({
  acquireWorkspaceLock: vi.fn(async () => ({
    release: vi.fn().mockResolvedValue(undefined),
  })),
  cleanupWorkspaceLock: vi.fn(async () => undefined),
}));

vi.mock('../../api/reporting.js', () => ({
  createKnowledgeCoverageReport: vi.fn(() => ({})),
  createLiBrainianRunReport: vi.fn(() => ({})),
  readLatestGovernorBudgetReport: vi.fn(() => null),
  writeKnowledgeCoverageReport: vi.fn(async () => undefined),
  writeLiBrainianRunReport: vi.fn(async () => undefined),
}));

vi.mock('../../observability/librainian_traces.js', () => ({
  createLiBrainianTraceContext: vi.fn(() => ({ traceId: 'trace-1' })),
  getLiBrainianTraceRefs: vi.fn(() => []),
  recordLiBrainianTrace: vi.fn(),
}));

vi.mock('../../events.js', () => ({
  globalEventBus: { emit: vi.fn() },
  createBootstrapStartedEvent: vi.fn(() => ({ type: 'bootstrap_started' })),
  createBootstrapCompleteEvent: vi.fn(() => ({ type: 'bootstrap_complete' })),
  createBootstrapPhaseCompleteEvent: vi.fn(() => ({ type: 'bootstrap_phase_complete' })),
}));

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

const installMissingGrammarsMock = vi.fn(async () => ({
  attempted: true,
  success: true,
  packageManager: 'npm',
  packages: ['tree-sitter-kotlin'],
}));

vi.mock('../../cli/grammar_support.js', () => ({
  scanWorkspaceLanguages: vi.fn(async () => ({
    workspace: '/tmp/mock',
    languageCounts: { kotlin: 10 },
    unknownExtensions: {},
    totalFiles: 10,
    truncated: false,
    errors: [],
  })),
  assessGrammarCoverage: vi.fn(() => ({
    workspace: '/tmp/mock',
    languagesDetected: ['kotlin'],
    languageCounts: { kotlin: 10 },
    unknownExtensions: {},
    supportedByTsMorph: [],
    supportedByTreeSitter: [],
    missingLanguageConfigs: [],
    missingGrammarModules: ['tree-sitter-kotlin'],
    missingTreeSitterCore: false,
    totalFiles: 10,
    truncated: false,
    errors: [],
  })),
  getMissingGrammarPackages: vi.fn(() => ['tree-sitter-kotlin']),
  installMissingGrammars: installMissingGrammarsMock,
}));

describe('first_run_gate degraded mode', () => {
  let workspace: string;

  beforeEach(async () => {
    capturedConfig = null;
    installMissingGrammarsMock.mockReset().mockResolvedValue({
      attempted: true,
      success: true,
      packageManager: 'npm',
      packages: ['tree-sitter-kotlin'],
    });
    workspace = path.join(tmpdir(), `librainian-gate-test-${Date.now()}`);
    await fs.mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('continues when LLM unavailable but embeddings are ready', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');
    const result = await ensureLiBrainianReady(workspace, { throwOnFailure: true });

    expect(result.success).toBe(true);
    expect(capturedConfig).toBeTruthy();
    expect(capturedConfig?.llmProvider).toBeUndefined();
    expect((capturedConfig?.bootstrapConfig as Record<string, unknown>)?.skipLlm).toBe(true);
  });

  it('forces skipLlm when requested even if providers are available', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');

    const providerGate = async () => ({
      ready: true,
      llmReady: true,
      embeddingReady: true,
      selectedProvider: 'claude' as const,
      providers: [
        { provider: 'claude', available: true, authenticated: true, lastCheck: Date.now() },
        { provider: 'codex', available: false, authenticated: false, lastCheck: Date.now(), error: 'unavailable' },
      ],
      embedding: {
        provider: 'xenova' as const,
        available: true,
        lastCheck: Date.now(),
      },
      remediationSteps: [],
      reason: 'OK',
      guidance: [],
      bypassed: false,
    });

    const result = await ensureLiBrainianReady(workspace, {
      throwOnFailure: true,
      providerGate,
      skipLlm: true,
    });

    expect(result.success).toBe(true);
    expect(capturedConfig).toBeTruthy();
    expect(capturedConfig?.llmProvider).toBeUndefined();
    expect((capturedConfig?.bootstrapConfig as Record<string, unknown>)?.skipLlm).toBe(true);
  });

  it('continues when embeddings are unavailable if degraded mode is allowed', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');

    const providerGate = async () => ({
      ready: false,
      llmReady: false,
      embeddingReady: false,
      selectedProvider: null,
      providers: [
        { provider: 'claude', available: false, authenticated: false, lastCheck: Date.now(), error: 'unavailable' },
        { provider: 'codex', available: false, authenticated: false, lastCheck: Date.now(), error: 'unavailable' },
      ],
      embedding: {
        provider: 'xenova' as const,
        available: false,
        lastCheck: Date.now(),
        error: 'embedding unavailable',
      },
      remediationSteps: ['Install @xenova/transformers'],
      reason: 'Embedding unavailable',
      guidance: [],
      bypassed: false,
    });

    const result = await ensureLiBrainianReady(workspace, {
      throwOnFailure: true,
      allowDegradedEmbeddings: true,
      providerGate,
    });

    expect(result.success).toBe(true);
    expect(capturedConfig).toBeTruthy();
    expect((capturedConfig?.bootstrapConfig as Record<string, unknown>)?.skipEmbeddings).toBe(true);
  });

  it('defaults to degraded mode when embeddings are unavailable', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');

    const providerGate = async () => ({
      ready: false,
      llmReady: false,
      embeddingReady: false,
      selectedProvider: null,
      providers: [
        { provider: 'claude', available: false, authenticated: false, lastCheck: Date.now(), error: 'unavailable' },
        { provider: 'codex', available: false, authenticated: false, lastCheck: Date.now(), error: 'unavailable' },
      ],
      embedding: {
        provider: 'xenova' as const,
        available: false,
        lastCheck: Date.now(),
        error: 'embedding unavailable',
      },
      remediationSteps: ['Install @xenova/transformers'],
      reason: 'Embedding unavailable',
      guidance: [],
      bypassed: false,
    });

    const result = await ensureLiBrainianReady(workspace, {
      throwOnFailure: true,
      providerGate,
    });

    expect(result.success).toBe(true);
    expect(capturedConfig).toBeTruthy();
    expect((capturedConfig?.bootstrapConfig as Record<string, unknown>)?.skipEmbeddings).toBe(true);
  });

  it('auto-detects workspace root when invoked from a subdirectory', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');
    const rootMarker = path.join(workspace, 'package.json');
    await fs.writeFile(rootMarker, '{}');
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'index.ts'), 'export const x = 1;');
    const subdir = path.join(workspace, 'docs');
    await fs.mkdir(subdir, { recursive: true });

    const result = await ensureLiBrainianReady(subdir, { throwOnFailure: true });

    expect(result.success).toBe(true);
    expect(capturedConfig).toBeTruthy();
    expect(capturedConfig?.workspace).toBe(workspace);
  });

  it('auto-installs missing grammars when enabled', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');
    const result = await ensureLiBrainianReady(workspace, { throwOnFailure: true, autoInstallGrammars: true });

    expect(result.success).toBe(true);
    expect(installMissingGrammarsMock).toHaveBeenCalled();
  });

  it('fails closed when strict parser coverage is required and grammar install fails', async () => {
    installMissingGrammarsMock.mockResolvedValueOnce({
      attempted: true,
      success: false,
      packageManager: 'npm',
      packages: ['tree-sitter-kotlin'],
      error: 'network failure',
    });
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');

    await expect(ensureLiBrainianReady(workspace, {
      throwOnFailure: true,
      autoInstallGrammars: true,
      requireCompleteParserCoverage: true,
    })).rejects.toThrow(/parser_coverage_incomplete/);
  });

  it('re-initializes when cached librainian instance is no longer ready', async () => {
    const { ensureLiBrainianReady } = await import('../first_run_gate.js');
    const { createLiBrainian } = await import('../../api/librainian.js');

    let firstReady = true;
    const firstInstance = {
      isReady: () => firstReady,
      getStatus: async () => ({ upgradeAvailable: false }),
      shutdown: async () => { firstReady = false; },
    };
    const secondInstance = {
      isReady: () => true,
      getStatus: async () => ({ upgradeAvailable: false }),
      shutdown: async () => undefined,
    };

    vi.mocked(createLiBrainian)
      .mockReset()
      .mockResolvedValueOnce(firstInstance as any)
      .mockResolvedValueOnce(secondInstance as any);

    const first = await ensureLiBrainianReady(workspace, { throwOnFailure: true });
    expect(first.success).toBe(true);
    expect(first.librainian).toBeTruthy();

    await first.librainian?.shutdown();

    const second = await ensureLiBrainianReady(workspace, { throwOnFailure: true });
    expect(second.success).toBe(true);
    expect(second.librainian).toBe(secondInstance);
    expect(createLiBrainian).toHaveBeenCalledTimes(2);
  });
});
