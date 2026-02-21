import { describe, expect, it, vi } from 'vitest';
import {
  ProviderChaosMiddleware,
  createProviderChaosConfigFromEnv,
  type ProviderChaosConfig,
  type ProviderExecResult,
} from '../provider_chaos.js';

function createConfig(sequence: ProviderChaosConfig['sequence']): ProviderChaosConfig {
  return {
    enabled: true,
    rate: 1,
    modes: ['timeout', 'error_response', 'truncated_response', 'garbage_response', 'slow_response'],
    sequence,
    slowDelayMs: 20,
    timeoutDelayMs: 1,
  };
}

function successResult(stdout = 'provider output is healthy and complete'): ProviderExecResult {
  return { exitCode: 0, stdout, stderr: '' };
}

describe('ProviderChaosMiddleware', () => {
  it('injects timeout mode', async () => {
    const chaos = new ProviderChaosMiddleware(createConfig(['timeout']));
    await expect(chaos.execute(async () => successResult())).rejects.toThrow('provider_chaos_timeout');
  });

  it('injects error_response mode', async () => {
    const chaos = new ProviderChaosMiddleware(createConfig(['error_response']));
    const result = await chaos.execute(async () => successResult());
    expect(result.chaosMode).toBe('error_response');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('provider_chaos_error_response');
  });

  it('injects truncated_response mode', async () => {
    const chaos = new ProviderChaosMiddleware(createConfig(['truncated_response']));
    const result = await chaos.execute(async () => successResult('abcdefghijklmnopqrstuvwxyz'));
    expect(result.chaosMode).toBe('truncated_response');
    expect(result.stdout.endsWith('...')).toBe(true);
    expect(result.stdout.length).toBeLessThan(26);
  });

  it('injects garbage_response mode', async () => {
    const chaos = new ProviderChaosMiddleware(createConfig(['garbage_response']));
    const result = await chaos.execute(async () => successResult());
    expect(result.chaosMode).toBe('garbage_response');
    expect(result.stdout).toContain('provider_chaos_garbage');
  });

  it('injects slow_response mode', async () => {
    const chaos = new ProviderChaosMiddleware(createConfig(['slow_response']));
    const before = Date.now();
    const result = await chaos.execute(async () => successResult());
    const elapsed = Date.now() - before;
    expect(result.chaosMode).toBe('slow_response');
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it('supports disabling chaos via environment config', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const config = createProviderChaosConfigFromEnv({});
      const chaos = new ProviderChaosMiddleware(config);
      const result = await chaos.execute(async () => successResult('healthy'));
      expect(result.chaosMode).toBeNull();
      expect(result.stdout).toBe('healthy');
    } finally {
      randomSpy.mockRestore();
    }
  });
});
