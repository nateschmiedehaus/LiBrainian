import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProviderReadinessGate } from '../api/provider_gate.js';
import type { AuthChecker, AuthStatusSummary } from '../utils/auth_checker.js';
import * as adapters from '../adapters/llm_service.js';
import type { LlmServiceAdapter } from '../adapters/llm_service.js';
import * as realEmbeddings from '../api/embedding_providers/real_embeddings.js';
import { SqliteEvidenceLedger, createSessionId } from '../epistemics/evidence_ledger.js';
import { getActiveProviderFailures, recordProviderFailure } from '../utils/provider_failures.js';

function buildAdapter(overrides: Partial<LlmServiceAdapter>): LlmServiceAdapter {
  return {
    chat: vi.fn(async () => ({ content: 'ok', provider: 'claude' })),
    checkClaudeHealth: async () => ({
      provider: 'claude',
      available: false,
      authenticated: false,
      lastCheck: Date.now(),
    }),
    checkCodexHealth: async () => ({
      provider: 'codex',
      available: false,
      authenticated: false,
      lastCheck: Date.now(),
    }),
    ...overrides,
  };
}

function buildAuthStatus(overrides: Partial<AuthStatusSummary> = {}): AuthStatusSummary {
  const base: AuthStatusSummary = {
    codex: { provider: 'codex', authenticated: false, lastChecked: 'now' },
    claude_code: { provider: 'claude_code', authenticated: false, lastChecked: 'now' },
  };
  return { ...base, ...overrides };
}

afterEach(() => {
  adapters.clearLlmServiceAdapter();
  vi.restoreAllMocks();
});

describe('runProviderReadinessGate', () => {
  it('returns ready when a provider is authenticated and available', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus({
        claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
      }),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const llmService = buildAdapter({
      checkClaudeHealth: async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      }),
      checkCodexHealth: async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
        error: 'missing',
      }),
    });

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
        modelId: 'all-MiniLM-L6-v2',
        dimension: 384,
      }),
      emitReport: false,
    });

    expect(result.ready).toBe(true);
    expect(result.selectedProvider).toBe('claude');
    expect(result.bypassed).toBe(false);
  });

  it('uses lightweight embedding probe by default', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus({
        codex: { provider: 'codex', authenticated: true, lastChecked: 'now', source: 'test' },
      }),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const llmService = buildAdapter({
      checkClaudeHealth: async () => ({
        provider: 'claude',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
        error: 'missing',
      }),
      checkCodexHealth: async () => ({
        provider: 'codex',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      }),
    });

    const xenovaSpy = vi.spyOn(realEmbeddings, 'isXenovaAvailable').mockResolvedValue(true);
    const sentenceSpy = vi.spyOn(realEmbeddings, 'isSentenceTransformersAvailable').mockResolvedValue(false);
    const runtimeProbeSpy = vi.spyOn(realEmbeddings, 'generateRealEmbedding');

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService,
      emitReport: false,
      forceProbe: false,
    });

    expect(result.ready).toBe(true);
    expect(result.embeddingReady).toBe(true);
    expect(result.embedding.provider).toBe('xenova');
    expect(xenovaSpy).toHaveBeenCalled();
    expect(sentenceSpy).toHaveBeenCalled();
    expect(runtimeProbeSpy).not.toHaveBeenCalled();
  });

  it('runs runtime embedding probe when forceProbe is enabled', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus({
        codex: { provider: 'codex', authenticated: true, lastChecked: 'now', source: 'test' },
      }),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const llmService = buildAdapter({
      checkClaudeHealth: async () => ({
        provider: 'claude',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
        error: 'missing',
      }),
      checkCodexHealth: async () => ({
        provider: 'codex',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      }),
    });

    const runtimeProbeSpy = vi.spyOn(realEmbeddings, 'generateRealEmbedding').mockResolvedValue({
      embedding: new Float32Array([0.25, 0.5]),
      provider: 'xenova',
      dimension: 2,
      model: 'all-MiniLM-L6-v2',
    });
    const xenovaSpy = vi.spyOn(realEmbeddings, 'isXenovaAvailable');
    const sentenceSpy = vi.spyOn(realEmbeddings, 'isSentenceTransformersAvailable');

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService,
      emitReport: false,
      forceProbe: true,
    });

    expect(result.ready).toBe(true);
    expect(result.embeddingReady).toBe(true);
    expect(runtimeProbeSpy).toHaveBeenCalled();
    expect(xenovaSpy).not.toHaveBeenCalled();
    expect(sentenceSpy).not.toHaveBeenCalled();
  });

  it('supports offline mode without probing LLM providers', async () => {
    const previousOffline = process.env.LIBRARIAN_OFFLINE;
    process.env.LIBRARIAN_OFFLINE = '1';
    try {
      const authChecker = {
        checkAll: async () => buildAuthStatus(),
        getAuthGuidance: () => [],
      } as unknown as AuthChecker;

      const llmService = buildAdapter({
        checkClaudeHealth: vi.fn(async () => ({
          provider: 'claude',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        })),
        checkCodexHealth: vi.fn(async () => ({
          provider: 'codex',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        })),
      });

      const result = await runProviderReadinessGate('/tmp', {
        authChecker,
        llmService,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
          modelId: 'all-MiniLM-L6-v2',
          dimension: 384,
        }),
        emitReport: false,
      });

      expect(result.ready).toBe(true);
      expect(result.bypassed).toBe(true);
      expect(result.llmReady).toBe(false);
      expect(result.embeddingReady).toBe(true);
      expect(result.selectedProvider).toBeNull();
      expect(llmService.checkClaudeHealth).not.toHaveBeenCalled();
      expect(llmService.checkCodexHealth).not.toHaveBeenCalled();
    } finally {
      if (typeof previousOffline === 'string') process.env.LIBRARIAN_OFFLINE = previousOffline;
      else delete process.env.LIBRARIAN_OFFLINE;
    }
  });

  it('records provider gate runs to the evidence ledger when provided', async () => {
    const ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();

    const authChecker = {
      checkAll: async () => buildAuthStatus({
        claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
      }),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const llmService = buildAdapter({
      checkClaudeHealth: async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      }),
      checkCodexHealth: async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      }),
    });

    const sessionId = createSessionId('sess_provider_gate_test');
    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
      ledger,
      sessionId,
    });

    expect(result.ready).toBe(true);

    const entries = await ledger.query({ kinds: ['tool_call'], sessionId });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload).toMatchObject({
      toolName: 'provider_gate',
      success: true,
    });

    await ledger.close();
  });

  it('fails closed when no providers are available', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => ['Codex: run `codex login`', 'Claude: run `claude setup-token` or run `claude`'],
    } as unknown as AuthChecker;

    const llmService = buildAdapter({
      checkClaudeHealth: async () => ({
        provider: 'claude',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
        error: 'not authenticated',
      }),
      checkCodexHealth: async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
        error: 'not authenticated',
      }),
    });

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService,
      embeddingHealthCheck: async () => ({
        provider: 'unknown',
        available: false,
        lastCheck: Date.now(),
        error: 'missing embedding provider',
      }),
      emitReport: false,
    });

    expect(result.ready).toBe(false);
    expect(result.selectedProvider).toBeNull();
    expect(result.reason).toContain('claude');
    expect(result.reason).toContain('codex');
    expect(result.remediationSteps).toEqual(expect.arrayContaining([
      'Claude: run `claude setup-token` or start `claude` once to authenticate (CLI-only; no API keys)',
      'Codex: run `codex login` to authenticate (CLI-only; no API keys)',
    ]));
  });

  it('prefers explicit adapter over registered adapter', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const registeredAdapter = buildAdapter({
      checkClaudeHealth: vi.fn(async () => ({
        provider: 'claude',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      })),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      })),
    });

    const explicitAdapter = buildAdapter({
      checkClaudeHealth: vi.fn(async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      })),
    });

    adapters.registerLlmServiceAdapter(registeredAdapter);

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService: explicitAdapter,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    expect(explicitAdapter.checkClaudeHealth).toHaveBeenCalled();
    expect(registeredAdapter.checkClaudeHealth).not.toHaveBeenCalled();
    expect(result.selectedProvider).toBe('claude');
  });

  it('uses registered adapter when no explicit adapter is provided', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const registeredAdapter = buildAdapter({
      checkClaudeHealth: vi.fn(async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      })),
    });

    adapters.registerLlmServiceAdapter(registeredAdapter);

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    expect(registeredAdapter.checkClaudeHealth).toHaveBeenCalled();
    expect(result.selectedProvider).toBe('claude');
  });

  it('falls back to default adapter when none is registered', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const defaultAdapter = buildAdapter({
      checkClaudeHealth: vi.fn(async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      })),
    });

    const defaultSpy = vi
      .spyOn(adapters, 'createDefaultLlmServiceAdapter')
      .mockReturnValue(defaultAdapter);

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    expect(defaultSpy).toHaveBeenCalled();
    expect(defaultAdapter.checkClaudeHealth).toHaveBeenCalled();
    expect(result.selectedProvider).toBe('claude');
  });

  it('auto-registers default LLM factory before default adapter health probes', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    const providerErrors = result.providers
      .map((provider) => provider.error)
      .filter((value): value is string => typeof value === 'string');
    expect(providerErrors.some((value) => value.includes('llm_adapter_unavailable'))).toBe(false);
  });

  it('records adapter validation failures from registry', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    vi.spyOn(adapters, 'getLlmServiceAdapter').mockReturnValue({} as LlmServiceAdapter);

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    expect(result.ready).toBe(false);
    expect(result.providers[0]?.error).toContain('llm_adapter_invalid');
    expect(result.remediationSteps).toEqual(
      expect.arrayContaining([expect.stringContaining('LLM adapter init failed')])
    );
  });

  it('records adapter validation failures from default adapter', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    vi.spyOn(adapters, 'getLlmServiceAdapter').mockReturnValue(null);
    vi.spyOn(adapters, 'createDefaultLlmServiceAdapter').mockReturnValue({} as LlmServiceAdapter);

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    expect(result.ready).toBe(false);
    expect(result.providers[0]?.error).toContain('llm_adapter_invalid');
  });

  it('handles health check rejections without crashing', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const llmService = buildAdapter({
      checkClaudeHealth: vi.fn(async () => {
        throw new Error('claude down');
      }),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
    });

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      llmService,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
      }),
      emitReport: false,
    });

    const claude = result.providers.find((entry) => entry.provider === 'claude');
    expect(claude?.available).toBe(false);
    expect(claude?.error).toContain('claude down');
    expect(result.selectedProvider).toBe('codex');
  });

  it('supports concurrent gate runs with shared registry', async () => {
    const authChecker = {
      checkAll: async () => buildAuthStatus(),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const registeredAdapter = buildAdapter({
      checkClaudeHealth: vi.fn(async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
      })),
    });

    adapters.registerLlmServiceAdapter(registeredAdapter);

    const [first, second] = await Promise.all([
      runProviderReadinessGate('/tmp', {
        authChecker,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      }),
      runProviderReadinessGate('/tmp', {
        authChecker,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      }),
    ]);

    expect(first.selectedProvider).toBe('claude');
    expect(second.selectedProvider).toBe('claude');
  });

  it('treats recent provider failures as unavailable', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-gate-'));
    try {
      await recordProviderFailure(workspaceRoot, {
        provider: 'claude',
        reason: 'rate_limit',
        message: 'Rate limit exceeded',
        ttlMs: 15 * 60 * 1000,
        at: new Date().toISOString(),
      });
      const activeFailures = await getActiveProviderFailures(workspaceRoot);
      expect(activeFailures.claude).toBeDefined();

      const authChecker = {
        checkAll: async () => buildAuthStatus({
          claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
        }),
        getAuthGuidance: () => [],
      } as unknown as AuthChecker;

      const llmService = buildAdapter({
        checkClaudeHealth: async () => ({
          provider: 'claude',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        }),
        checkCodexHealth: async () => ({
          provider: 'codex',
          available: false,
          authenticated: false,
          lastCheck: Date.now(),
        }),
      });

      const result = await runProviderReadinessGate(workspaceRoot, {
        authChecker,
        llmService,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      });

      const claudeStatus = result.providers.find((provider) => provider.provider === 'claude');
      expect(claudeStatus?.available).toBe(false);
      expect(result.llmReady).toBe(false);
      expect(result.selectedProvider).toBeNull();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('treats recent unavailable provider failures as sticky and auto-repairs selection', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-gate-unavailable-'));
    try {
      await recordProviderFailure(workspaceRoot, {
        provider: 'claude',
        reason: 'unavailable',
        message: 'cannot be launched inside another Claude Code session',
        ttlMs: 10 * 60 * 1000,
        at: new Date().toISOString(),
      });

      const authChecker = {
        checkAll: async () =>
          buildAuthStatus({
            claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
            codex: { provider: 'codex', authenticated: true, lastChecked: 'now', source: 'test' },
          }),
        getAuthGuidance: () => [],
      } as unknown as AuthChecker;

      const llmService = buildAdapter({
        checkClaudeHealth: async () => ({
          provider: 'claude',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        }),
        checkCodexHealth: async () => ({
          provider: 'codex',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        }),
      });

      const result = await runProviderReadinessGate(workspaceRoot, {
        authChecker,
        llmService,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      });

      const claudeStatus = result.providers.find((provider) => provider.provider === 'claude');
      expect(claudeStatus?.available).toBe(false);
      expect(result.selectedProvider).toBe('codex');
      expect(result.autoRepair).toMatchObject({
        from: 'claude',
        to: 'codex',
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('clears sticky recent failures after successful forced probe', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-gate-force-probe-'));
    try {
      await recordProviderFailure(workspaceRoot, {
        provider: 'claude',
        reason: 'rate_limit',
        message: 'Rate limit exceeded',
        ttlMs: 15 * 60 * 1000,
        at: new Date().toISOString(),
      });

      const authChecker = {
        checkAll: async () => buildAuthStatus({
          claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
        }),
        getAuthGuidance: () => [],
      } as unknown as AuthChecker;

      const llmService = buildAdapter({
        checkClaudeHealth: async () => ({
          provider: 'claude',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        }),
        checkCodexHealth: async () => ({
          provider: 'codex',
          available: false,
          authenticated: false,
          lastCheck: Date.now(),
        }),
      });

      const result = await runProviderReadinessGate(workspaceRoot, {
        authChecker,
        llmService,
        forceProbe: true,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      });

      const claudeStatus = result.providers.find((provider) => provider.provider === 'claude');
      expect(claudeStatus?.available).toBe(true);
      expect(result.llmReady).toBe(true);
      expect(result.selectedProvider).toBe('claude');

      const failuresAfter = await getActiveProviderFailures(workspaceRoot);
      expect(failuresAfter.claude).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('auto-repairs provider selection by falling back to the next healthy provider', async () => {
    const previousProvider = process.env.LIBRARIAN_LLM_PROVIDER;
    process.env.LIBRARIAN_LLM_PROVIDER = 'claude';
    try {
      const authChecker = {
        checkAll: async () =>
          buildAuthStatus({
            claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
            codex: { provider: 'codex', authenticated: true, lastChecked: 'now', source: 'test' },
          }),
        getAuthGuidance: () => [],
      } as unknown as AuthChecker;

      const llmService = buildAdapter({
        checkClaudeHealth: async () => ({
          provider: 'claude',
          available: false,
          authenticated: false,
          lastCheck: Date.now(),
          error: 'provider temporarily unavailable',
        }),
        checkCodexHealth: async () => ({
          provider: 'codex',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        }),
      });

      const result = await runProviderReadinessGate('/tmp', {
        authChecker,
        llmService,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      });

      expect(result.ready).toBe(true);
      expect(result.selectedProvider).toBe('codex');
      expect(result.autoRepair).toMatchObject({
        from: 'claude',
        to: 'codex',
      });
      expect(result.remediationSteps).toEqual(
        expect.arrayContaining([expect.stringContaining('Auto-repaired provider selection: claude -> codex')])
      );
    } finally {
      if (typeof previousProvider === 'string') process.env.LIBRARIAN_LLM_PROVIDER = previousProvider;
      else delete process.env.LIBRARIAN_LLM_PROVIDER;
    }
  });

  it('does not hard-disable provider selection for non-sticky recent failures', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-gate-'));
    try {
      await recordProviderFailure(workspaceRoot, {
        provider: 'claude',
        reason: 'unknown',
        message: 'Claude CLI transient error',
        ttlMs: 10 * 60 * 1000,
        at: new Date().toISOString(),
      });

      const authChecker = {
        checkAll: async () => buildAuthStatus({
          claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
        }),
        getAuthGuidance: () => [],
      } as unknown as AuthChecker;

      const llmService = buildAdapter({
        checkClaudeHealth: async () => ({
          provider: 'claude',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        }),
        checkCodexHealth: async () => ({
          provider: 'codex',
          available: false,
          authenticated: false,
          lastCheck: Date.now(),
        }),
      });

      const result = await runProviderReadinessGate(workspaceRoot, {
        authChecker,
        llmService,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
        }),
        emitReport: false,
      });

      const claudeStatus = result.providers.find((provider) => provider.provider === 'claude');
      expect(claudeStatus?.available).toBe(true);
      expect(result.llmReady).toBe(true);
      expect(result.selectedProvider).toBe('claude');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('Provider Resilience Gate', () => {
  it('tests all registered providers can initialize', async () => {
    const authChecker = {
      checkAll: async () =>
        buildAuthStatus({
          claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
          codex: { provider: 'codex', authenticated: true, lastChecked: 'now', source: 'test' },
        }),
      getAuthGuidance: () => [],
    } as unknown as AuthChecker;

    const registeredAdapter = buildAdapter({
      checkClaudeHealth: vi.fn(async () => ({
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
      checkCodexHealth: vi.fn(async () => ({
        provider: 'codex',
        available: true,
        authenticated: true,
        lastCheck: Date.now(),
      })),
    });
    adapters.registerLlmServiceAdapter(registeredAdapter);

    const result = await runProviderReadinessGate('/tmp', {
      authChecker,
      embeddingHealthCheck: async () => ({
        provider: 'xenova',
        available: true,
        lastCheck: Date.now(),
        modelId: 'all-MiniLM-L6-v2',
        dimension: 384,
      }),
      emitReport: false,
    });

    expect(registeredAdapter.checkClaudeHealth).toHaveBeenCalledTimes(1);
    expect(registeredAdapter.checkCodexHealth).toHaveBeenCalledTimes(1);
    expect(result.providers.map((provider) => provider.provider)).toEqual(expect.arrayContaining(['claude', 'codex']));
    expect(result.ready).toBe(true);
  });

  it('survives provider failures with single-line errors and recovers on the next run', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-resilience-'));
    try {
      const authChecker = {
        checkAll: async () =>
          buildAuthStatus({
            claude_code: { provider: 'claude_code', authenticated: true, lastChecked: 'now', source: 'test' },
            codex: { provider: 'codex', authenticated: true, lastChecked: 'now', source: 'test' },
          }),
        getAuthGuidance: () => ['Retry after cooldown if provider times out'],
      } as unknown as AuthChecker;

      const failingAdapter = buildAdapter({
        checkClaudeHealth: vi.fn(async () => {
          throw new Error('claude timeout\nstack trace');
        }),
        checkCodexHealth: vi.fn(async () => {
          throw new Error('codex timeout\nstack trace');
        }),
      });

      const failedResult = await runProviderReadinessGate(workspaceRoot, {
        authChecker,
        llmService: failingAdapter,
        embeddingHealthCheck: async () => ({
          provider: 'unknown',
          available: false,
          lastCheck: Date.now(),
          error: 'embedding timeout\ntrace line',
        }),
        emitReport: false,
      });

      expect(failedResult.ready).toBe(false);
      expect(failedResult.providers.every((provider) => !provider.error?.includes('\n'))).toBe(true);
      expect(failedResult.embedding.error?.includes('\n')).toBe(false);
      expect(failedResult.reason?.includes('\n')).toBe(false);

      const recoveryAdapter = buildAdapter({
        checkClaudeHealth: vi.fn(async () => ({
          provider: 'claude',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        })),
        checkCodexHealth: vi.fn(async () => ({
          provider: 'codex',
          available: true,
          authenticated: true,
          lastCheck: Date.now(),
        })),
      });

      const recoveredResult = await runProviderReadinessGate(workspaceRoot, {
        authChecker,
        llmService: recoveryAdapter,
        embeddingHealthCheck: async () => ({
          provider: 'xenova',
          available: true,
          lastCheck: Date.now(),
          modelId: 'all-MiniLM-L6-v2',
          dimension: 384,
        }),
        emitReport: false,
      });

      expect(recoveredResult.ready).toBe(true);
      expect(recoveredResult.llmReady).toBe(true);
      expect(recoveredResult.embeddingReady).toBe(true);
      expect(recoveredResult.selectedProvider).not.toBeNull();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
