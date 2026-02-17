import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureWave0AdapterRegistration } from '../wave0_adapter_wiring.js';
import { clearModelPolicyProvider, ensureDailyModelSelection } from '../model_policy.js';

describe('ensureWave0AdapterRegistration model policy wiring', () => {
  const originalProvider = process.env.LIBRARIAN_LLM_PROVIDER;
  const originalModel = process.env.LIBRARIAN_LLM_MODEL;
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearModelPolicyProvider();
    if (originalProvider === undefined) delete process.env.LIBRARIAN_LLM_PROVIDER;
    else process.env.LIBRARIAN_LLM_PROVIDER = originalProvider;
    if (originalModel === undefined) delete process.env.LIBRARIAN_LLM_MODEL;
    else process.env.LIBRARIAN_LLM_MODEL = originalModel;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers a standalone model policy provider when repo policy is unavailable', async () => {
    clearModelPolicyProvider();
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    process.env.LIBRARIAN_LLM_MODEL = 'gpt-5-codex';
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'librarian-wave0-adapter-'));
    tempDirs.push(workspaceRoot);

    await ensureWave0AdapterRegistration(workspaceRoot);

    const selection = await ensureDailyModelSelection(workspaceRoot, { forceRefresh: true });
    expect(selection.notes).not.toContain('fallback_model_policy_provider_missing');
    expect(selection.notes).toContain('standalone_model_policy_provider');
    expect(selection.providers.codex?.model_id).toBe('gpt-5-codex');
  });
});
