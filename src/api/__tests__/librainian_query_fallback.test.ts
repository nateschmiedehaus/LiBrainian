import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibrarianResponse } from '../../types.js';
import { Librarian } from '../librarian.js';
import { ProviderUnavailableError } from '../provider_check.js';
import { getCurrentVersion } from '../versioning.js';
import { queryLibrarian } from '../query.js';

vi.mock('../query.js', () => ({
  queryLibrarian: vi.fn(),
}));

const queryMock = vi.mocked(queryLibrarian);

function buildResponse(overrides: Partial<LibrarianResponse> = {}): LibrarianResponse {
  return {
    query: { intent: 'test', depth: 'L0', llmRequirement: 'optional', ...(overrides.query ?? {}) },
    packs: [],
    disclosures: [],
    traceId: 'unverified_by_trace(replay_unavailable)',
    constructionPlan: {
      id: 'cp_test',
      templateId: 'T1',
      ucIds: [],
      intent: 'test',
      source: 'default',
      createdAt: new Date().toISOString(),
    },
    totalConfidence: 0,
    cacheHit: false,
    latencyMs: 1,
    version: getCurrentVersion(),
    drillDownHints: [],
    llmRequirement: 'optional',
    llmAvailable: true,
    ...overrides,
  };
}

function createReadyLibrarian(): Librarian {
  const librarian = new Librarian({ workspace: '/tmp', autoBootstrap: false });
  const instance = librarian as unknown as {
    initialized: boolean;
    bootstrapped: boolean;
    storage: unknown;
    engines: unknown;
  };
  instance.initialized = true;
  instance.bootstrapped = true;
  instance.storage = {};
  instance.engines = null;
  return librarian;
}

describe('Librarian.queryWithFallback', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns success when LLM is available', async () => {
    const librarian = createReadyLibrarian();
    const response = buildResponse({ llmRequirement: 'optional', llmAvailable: true });
    queryMock.mockResolvedValueOnce(response);

    const result = await librarian.queryWithFallback({ intent: 'test', depth: 'L0' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.llmAvailable).toBe(true);
    }
  });

  it('returns llm_unavailable with partial result when LLM is unavailable', async () => {
    const librarian = createReadyLibrarian();
    const response = buildResponse({ llmRequirement: 'optional', llmAvailable: false });
    queryMock.mockResolvedValueOnce(response);

    const result = await librarian.queryWithFallback({ intent: 'test', depth: 'L0' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('llm_unavailable');
      expect(result.partialResult?.llmAvailable).toBe(false);
    }
  });

  it('sanitizes trace markers on direct API query responses', async () => {
    const librarian = createReadyLibrarian();
    queryMock.mockResolvedValueOnce(buildResponse({
      disclosures: ['unverified_by_trace(storage_write_degraded): Session degraded due to lock contention.'],
      llmError: 'unverified_by_trace(provider_unavailable): Embedding provider unavailable',
      coverageGaps: ['unverified_by_trace(provider_unavailable): Embedding provider unavailable'],
      methodHints: ['unverified_by_trace(provider_unavailable): Run provider diagnostics.'],
      drillDownHints: ['unverified_by_trace(provider_unavailable): Retry query after provider setup.'],
    }));

    const response = await librarian.queryOptional({ intent: 'test', depth: 'L0' });

    expect(response.disclosures).toEqual(['Session degraded due to lock contention.']);
    expect(response.traceId).toBe('replay_unavailable');
    expect(response.llmError).toBe('Embedding provider unavailable');
    expect(response.coverageGaps).toEqual(['Embedding provider unavailable']);
    expect(response.methodHints).toEqual(['Run provider diagnostics.']);
    expect(response.drillDownHints).toEqual(['Retry query after provider setup.']);
    expect(response.disclosures.join(' ')).not.toContain('unverified_by_trace');
    expect(response.epistemicsDebug?.join(' ')).toContain('unverified_by_trace(storage_write_degraded)');
    expect(response.epistemicsDebug?.join(' ')).toContain('unverified_by_trace(replay_unavailable)');
  });

  it('returns success when LLM is disabled by request', async () => {
    const librarian = createReadyLibrarian();
    const response = buildResponse({ llmRequirement: 'disabled', llmAvailable: false });
    queryMock.mockResolvedValueOnce(response);

    const result = await librarian.queryWithFallback({ intent: 'test', depth: 'L0', llmRequirement: 'disabled' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.llmRequirement).toBe('disabled');
    }
  });

  it('returns llm_unavailable when ProviderUnavailableError includes LLM', async () => {
    const librarian = createReadyLibrarian();
    queryMock.mockRejectedValueOnce(new ProviderUnavailableError({
      message: 'unverified_by_trace(provider_unavailable): test',
      missing: ['LLM: unavailable'],
      suggestion: 'authenticate',
    }));

    const result = await librarian.queryWithFallback({ intent: 'test', depth: 'L0' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('llm_unavailable');
    }
  });

  it('rethrows ProviderUnavailableError when LLM is not missing', async () => {
    const librarian = createReadyLibrarian();
    queryMock.mockRejectedValueOnce(new ProviderUnavailableError({
      message: 'unverified_by_trace(provider_unavailable): test',
      missing: ['Embedding: unavailable'],
      suggestion: 'authenticate',
    }));

    await expect(librarian.queryWithFallback({ intent: 'test', depth: 'L0' }))
      .rejects
      .toThrow(ProviderUnavailableError);
  });
});
