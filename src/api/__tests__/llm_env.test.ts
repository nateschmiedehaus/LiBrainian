import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const discoverLlmProviderMock = vi.hoisted(() => vi.fn());
const getAllProviderStatusMock = vi.hoisted(() => vi.fn());
const getProbeMock = vi.hoisted(() => vi.fn());

vi.mock('../llm_provider_discovery.js', () => ({
  discoverLlmProvider: discoverLlmProviderMock,
  getAllProviderStatus: getAllProviderStatusMock,
  llmProviderRegistry: {
    getProbe: getProbeMock,
  },
}));

const envSnapshot = { ...process.env };
const cwdSnapshot = process.cwd();

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

beforeEach(() => {
  restoreEnv(envSnapshot);
  discoverLlmProviderMock.mockReset();
  getAllProviderStatusMock.mockReset();
  getProbeMock.mockReset();
});

afterEach(async () => {
  process.chdir(cwdSnapshot);
  restoreEnv(envSnapshot);
});

describe('llm env provider precedence', () => {
  it('gives explicit provider env precedence over host agent hint', async () => {
    const llmEnv = await vi.importActual<typeof import('../llm_env.js')>('../llm_env.js');
    process.env.LIBRARIAN_LLM_PROVIDER = 'claude';
    process.env.LIBRARIAN_LLM_MODEL = 'claude-explicit';
    process.env.LIBRARIAN_HOST_AGENT = 'codex';

    const resolved = await llmEnv.resolveLibrarianModelConfigWithDiscovery();

    expect(llmEnv.resolveLibrarianProvider()).toBe('claude');
    expect(resolved).toEqual({ provider: 'claude', modelId: 'claude-explicit' });
    expect(discoverLlmProviderMock).not.toHaveBeenCalled();
  });

  it('uses host agent provider when explicit provider env is absent', async () => {
    const llmEnv = await vi.importActual<typeof import('../llm_env.js')>('../llm_env.js');
    process.env.LIBRARIAN_HOST_AGENT = 'codex';
    getProbeMock.mockReturnValue({
      descriptor: { defaultModel: 'gpt-5-codex' },
    });

    const resolved = await llmEnv.resolveLibrarianModelConfigWithDiscovery();

    expect(llmEnv.resolveLibrarianProvider()).toBe('codex');
    expect(resolved).toEqual({ provider: 'codex', modelId: 'gpt-5-codex' });
    expect(discoverLlmProviderMock).not.toHaveBeenCalled();
  });

  it('prefers last successful provider as discovery hint when no env or host hint is set', async () => {
    const llmEnv = await vi.importActual<typeof import('../llm_env.js')>('../llm_env.js');
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-llm-env-'));
    const providerDir = path.join(tempRoot, 'state', 'audits', 'librarian', 'provider');
    await fs.mkdir(providerDir, { recursive: true });
    await fs.writeFile(
      path.join(providerDir, 'last_successful_provider.json'),
      JSON.stringify({ provider: 'codex' }) + '\n',
      'utf8'
    );
    process.chdir(tempRoot);
    discoverLlmProviderMock.mockResolvedValue({
      provider: 'codex',
      modelId: 'gpt-5-codex',
    });

    try {
      const resolved = await llmEnv.resolveLibrarianModelConfigWithDiscovery();
      expect(discoverLlmProviderMock).toHaveBeenCalledWith({
        preferredProviders: ['codex'],
      });
      expect(resolved).toEqual({ provider: 'codex', modelId: 'gpt-5-codex' });
    } finally {
      process.chdir(cwdSnapshot);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
