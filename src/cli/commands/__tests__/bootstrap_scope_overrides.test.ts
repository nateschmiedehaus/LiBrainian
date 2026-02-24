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
});
