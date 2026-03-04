import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const envSnapshot = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
}

describe('resolveLibrarianModelConfigWithDiscovery', () => {
  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('normalizes cross-provider model IDs before returning env config', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    process.env.LIBRARIAN_LLM_MODEL = 'claude-sonnet-4-5-20241022';

    const actual = await vi.importActual<typeof import('../llm_env.js')>('../llm_env.js');
    const resolved = await actual.resolveLibrarianModelConfigWithDiscovery();

    expect(resolved).toEqual({
      provider: 'codex',
      modelId: 'gpt-5-codex',
    });
  });
});
