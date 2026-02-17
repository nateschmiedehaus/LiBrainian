import { afterEach, describe, expect, it } from 'vitest';
import { clearModelPolicyProvider, ensureDailyModelSelection } from '../model_policy.js';

describe('model policy fallback selection', () => {
  const originalProvider = process.env.LIBRARIAN_LLM_PROVIDER;
  const originalModel = process.env.LIBRARIAN_LLM_MODEL;

  afterEach(() => {
    clearModelPolicyProvider();
    if (originalProvider === undefined) delete process.env.LIBRARIAN_LLM_PROVIDER;
    else process.env.LIBRARIAN_LLM_PROVIDER = originalProvider;
    if (originalModel === undefined) delete process.env.LIBRARIAN_LLM_MODEL;
    else process.env.LIBRARIAN_LLM_MODEL = originalModel;
  });

  it('returns fallback selection when no provider is registered', async () => {
    clearModelPolicyProvider();
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    process.env.LIBRARIAN_LLM_MODEL = 'gpt-5-codex-low';

    const selection = await ensureDailyModelSelection('/tmp/librarian-test');

    expect(selection).toBeTruthy();
    expect(selection?.providers.codex?.model_id).toBe('gpt-5-codex-low');
    expect(selection?.providers.claude).toBeNull();
    expect(selection?.notes).toContain('fallback_model_policy_provider_missing');
  });
});
