import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProviderReadinessGate } from '../api/provider_gate.js';
import type { AuthChecker, AuthStatusSummary } from '../utils/auth_checker.js';
import * as adapters from '../adapters/llm_service.js';
import type { LlmServiceAdapter } from '../adapters/llm_service.js';
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
});
