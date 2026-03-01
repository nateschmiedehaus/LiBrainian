import { describe, expect, it } from 'vitest';
import { __testing } from '../query.js';

describe('query bootstrap fallback helpers', () => {
  it('detects bootstrap validation failures from include-pattern/indexing fatal errors', () => {
    const error = new Error(
      "Bootstrap phase 'semantic_indexing' had fatal validation failures. CRITICAL: 1506 files discovered in workspace but 0 were indexed."
    );
    expect(__testing.isBootstrapValidationFailure(error)).toBe(true);
  });

  it('allows fallback when bootstrap validation fails but usable index already exists', async () => {
    const storage = {
      getStats: async () => ({
        totalFunctions: 120,
        totalModules: 18,
      }),
    } as { getStats: () => Promise<{ totalFunctions: number; totalModules: number }> };

    const decision = await __testing.evaluateBootstrapFailureFallback(
      storage as never,
      new Error('include patterns match 1506 files but 0 were indexed (postcondition fatal)')
    );

    expect(decision.allowContinue).toBe(true);
    expect(decision.notice).toContain('using last successful index snapshot');
  });

  it('blocks fallback when no usable index exists', async () => {
    const storage = {
      getStats: async () => ({
        totalFunctions: 0,
        totalModules: 0,
      }),
    } as { getStats: () => Promise<{ totalFunctions: number; totalModules: number }> };

    const decision = await __testing.evaluateBootstrapFailureFallback(
      storage as never,
      new Error('include patterns match 1506 files but 0 were indexed (postcondition fatal)')
    );

    expect(decision.allowContinue).toBe(false);
  });
});

