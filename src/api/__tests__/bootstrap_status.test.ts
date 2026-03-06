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

describe('getBootstrapStatus', () => {
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

  it('returns default bootstrap status with llm synthesis when no nested markers are present', async () => {
    const { getBootstrapStatus } = await import('../bootstrap.js');
    const status = getBootstrapStatus('/tmp/workspace');
    expect(status.status).toBe('not_started');
    expect(status.synthesis?.synthesisMode).toBe('llm');
  });

  it('returns structural-only synthesis metadata when nested Claude markers are set without an alternate route', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LIBRARIAN_CLAUDE_BROKER_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_MODEL;
    delete process.env.CODEX_PROFILE;
    process.env.CLAUDE_CODE_SESSION = '1';

    const { getBootstrapStatus } = await import('../bootstrap.js');
    const status = getBootstrapStatus('/tmp/workspace');

    expect(status.status).toBe('not_started');
    expect(status.synthesis?.synthesisMode).toBe('structural-only');
    expect(status.synthesis?.synthesisUnavailableReason).toMatch(/nested claude code session/i);
  });
});
