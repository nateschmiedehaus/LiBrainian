import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envSnapshot = { ...process.env };
const NESTED_MARKER_KEYS = [
  'CLAUDE_CODE',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_SESSION',
  'SESSION_ID',
  'ANTHROPIC_CLAUDE_CODE',
  'ANTHROPIC_CLAUDE_CODE_SESSION',
] as const;

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('resolveSynthesisAvailability', () => {
  beforeEach(() => {
    vi.resetModules();
    restoreEnv(envSnapshot);
    for (const key of NESTED_MARKER_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    for (const key of NESTED_MARKER_KEYS) {
      delete process.env[key];
    }
  });

  it('returns structural-only when nested Claude session markers are present without an alternate route', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LIBRARIAN_CLAUDE_BROKER_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_MODEL;
    delete process.env.CODEX_PROFILE;
    process.env.CLAUDE_CODE_SESSION = '1';

    const { resolveSynthesisAvailability } = await import('../llm_env.js');
    const availability = resolveSynthesisAvailability();

    expect(availability.synthesisMode).toBe('structural-only');
    expect(availability.synthesisUnavailableReason).toMatch(/Nested Claude Code session detected/);
  });

  it('returns llm mode when nested sessions have codex configured', async () => {
    process.env.CLAUDE_CODE_SESSION = '1';
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';

    const { resolveSynthesisAvailability } = await import('../llm_env.js');

    expect(resolveSynthesisAvailability()).toEqual({ synthesisMode: 'llm' });
  });

  it('returns llm mode when nested sessions have Anthropic API transport configured', async () => {
    process.env.CLAUDE_CODE_SESSION = '1';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const { resolveSynthesisAvailability } = await import('../llm_env.js');

    expect(resolveSynthesisAvailability()).toEqual({ synthesisMode: 'llm' });
  });

  it('returns llm mode when nested sessions have Claude broker transport configured', async () => {
    process.env.CLAUDE_CODE_SESSION = '1';
    process.env.LIBRARIAN_CLAUDE_BROKER_URL = 'http://127.0.0.1:8787';

    const { resolveSynthesisAvailability } = await import('../llm_env.js');

    expect(resolveSynthesisAvailability()).toEqual({ synthesisMode: 'llm' });
  });
});
