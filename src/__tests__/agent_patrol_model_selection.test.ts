import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('agent patrol codex model selection policy', () => {
  it('uses latest medium model for patrol and cheapest model for internal indexing/synthesis', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-patrol-models-'));
    const codexDir = path.join(tmpHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'gpt-5-codex-low' },
          { slug: 'gpt-5-codex-medium' },
          { slug: 'gpt-5-codex-mini' },
          { slug: 'gpt-5-codex-medium-2026-02-20' },
        ],
      }),
      'utf8',
    );

    const mod = await import('../../scripts/agent-patrol.mjs');
    const selection = mod.resolveCheapestModels('codex', { homeDir: tmpHome });

    expect(selection.llmProvider).toBe('codex');
    expect(selection.llmModel).toBe('gpt-5-codex-medium-2026-02-20');
    expect(selection.internalLlmModel).toBe('gpt-5-codex-mini');
  });

  it('propagates the cheapest internal codex model to LiBrainian env', async () => {
    const mod = await import('../../scripts/agent-patrol.mjs');
    const env = mod.buildCheapModelEnv({
      llmProvider: 'codex',
      llmModel: 'gpt-5-codex-medium',
      internalLlmModel: 'gpt-5-codex-mini',
      embeddingModel: 'all-MiniLM-L6-v2',
      embeddingProvider: 'xenova',
    });

    expect(env.LIBRARIAN_LLM_PROVIDER).toBe('codex');
    expect(env.LIBRARIAN_LLM_MODEL).toBe('gpt-5-codex-mini');
  });
});
