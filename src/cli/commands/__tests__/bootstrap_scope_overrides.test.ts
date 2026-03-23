import { describe, expect, it } from 'vitest';
import { __testing } from '../bootstrap.js';

describe('bootstrap scope overrides', () => {
  it('omits src/__tests__ include pattern for librarian scope in fast mode', () => {
    const overrides = __testing.resolveScopeOverrides('librarian', 'fast');
    expect(overrides.include).toBeDefined();
    expect(overrides.include).not.toContain('src/__tests__/**/*.ts');
    expect(overrides.exclude).toContain('src/**/__tests__/**');
    expect(overrides.exclude).toContain('src/**/*.test.ts');
    expect(overrides.exclude).toContain('src/**/*.spec.ts');
  });

  it('omits src/__tests__ include pattern for librarian scope in full mode', () => {
    const overrides = __testing.resolveScopeOverrides('librarian', 'full');
    expect(overrides.include).toBeDefined();
    expect(overrides.include).not.toContain('src/__tests__/**/*.ts');
    expect(overrides.exclude).toContain('src/**/__tests__/**');
    expect(overrides.exclude).toContain('src/**/*.test.ts');
    expect(overrides.exclude).toContain('src/**/*.spec.ts');
  });

  it('accepts non-negative timeout values', () => {
    expect(__testing.parseNonNegativeInt('0', 'timeout')).toBe(0);
    expect(__testing.parseNonNegativeInt('2500', 'timeout')).toBe(2500);
  });

  it('rejects negative timeout values', () => {
    expect(() => __testing.parseNonNegativeInt('-1', 'timeout')).toThrow('--timeout must be a non-negative integer');
  });

  it('fails fast when bootstrap timeout budget is exceeded', async () => {
    await expect(
      __testing.withBootstrapCommandTimeout(20, async () => new Promise<never>(() => {}))
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('does not time out when bootstrap work completes in budget', async () => {
    await expect(
      __testing.withBootstrapCommandTimeout(200, async () => 'ok')
    ).resolves.toBe('ok');
  });

  it('treats skipped provider checks as degraded rather than success', () => {
    const readiness = __testing.describeProviderReadiness({
      explicitLlmRequested: false,
      providerCheckSkipped: true,
      localEmbeddingAvailable: true,
      providerStatus: null,
    });

    expect(readiness.level).toBe('skipped');
    expect(readiness.spinnerAction).toBe('stop');
    expect(readiness.readyMessage).toMatch(/unverified provider readiness/i);
    expect(readiness.notices.join(' ')).toMatch(/skipped/i);
  });

  it('treats partial provider readiness as limited rather than success', () => {
    const readiness = __testing.describeProviderReadiness({
      explicitLlmRequested: false,
      providerCheckSkipped: false,
      providerStatus: {
        llm: { available: false, provider: 'claude', model: 'unknown', latencyMs: 10, error: 'auth missing' },
        embedding: { available: true, provider: 'xenova', model: 'gte-small', latencyMs: 10 },
      },
    });

    expect(readiness.level).toBe('limited');
    expect(readiness.spinnerAction).toBe('stop');
    expect(readiness.readyMessage).toMatch(/limited provider readiness/i);
    expect(readiness.notices).toContain('LLM provider unavailable; continuing in heuristic mode.');
    expect(readiness.notices).toContain('LLM check: auth missing');
  });

  it('reports provider verification failures as failures, not success', () => {
    const readiness = __testing.describeProviderReadiness({
      explicitLlmRequested: true,
      providerCheckSkipped: false,
      providerStatus: null,
      error: new Error('probe timeout'),
    });

    expect(readiness.level).toBe('failed');
    expect(readiness.spinnerAction).toBe('fail');
    expect(readiness.spinnerMessage).toMatch(/failed/i);
    expect(readiness.readyMessage).toMatch(/cannot continue/i);
    expect(readiness.notices).toContain('Provider verification failed; bootstrap stopped before creating a degraded install.');
  });

  it('fails when embeddings are unavailable even if LLM is available', () => {
    const readiness = __testing.describeProviderReadiness({
      explicitLlmRequested: false,
      providerCheckSkipped: false,
      providerStatus: {
        llm: { available: true, provider: 'claude', model: 'haiku', latencyMs: 10 },
        embedding: { available: false, provider: 'xenova', model: 'gte-small', latencyMs: 10, error: 'missing model' },
      },
    });

    expect(readiness.level).toBe('failed');
    expect(readiness.spinnerAction).toBe('fail');
    expect(readiness.spinnerMessage).toMatch(/embedding provider unavailable/i);
    expect(readiness.notices).toContain('Embedding provider unavailable; semantic retrieval is required for bootstrap.');
    expect(readiness.notices).toContain('Embedding check: missing model');
    expect(readiness.readyMessage).toMatch(/cannot continue without semantic embeddings/i);
  });

  it('keeps success wording only when both provider classes are ready', () => {
    const readiness = __testing.describeProviderReadiness({
      explicitLlmRequested: false,
      providerCheckSkipped: false,
      providerStatus: {
        llm: { available: true, provider: 'claude', model: 'haiku', latencyMs: 10 },
        embedding: { available: true, provider: 'xenova', model: 'gte-small', latencyMs: 10 },
      },
    });

    expect(readiness.level).toBe('ready');
    expect(readiness.spinnerAction).toBe('succeed');
    expect(readiness.readyMessage).toMatch(/LiBrainian is ready!/);
  });
});
