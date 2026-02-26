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

  it('keeps src/__tests__ include pattern for librarian scope in full mode', () => {
    const overrides = __testing.resolveScopeOverrides('librarian', 'full');
    expect(overrides.include).toBeDefined();
    expect(overrides.include).toContain('src/__tests__/**/*.ts');
    expect(overrides.exclude).not.toContain('src/**/__tests__/**');
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
});
