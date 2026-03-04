import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const envSnapshot = { ...process.env };

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
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('returns not_started status when synthesis is available', async () => {
    const { getBootstrapStatus } = await import('../bootstrap.js');
    const status = getBootstrapStatus('/tmp/workspace');
    expect(status.status).toBe('not_started');
    expect(status.synthesis?.synthesisMode).toBe('llm');
  });

  it('returns synthesis_unavailable status when nested Claude markers are set', async () => {
    process.env.CLAUDE_CODE_SESSION = '1';
    const { getBootstrapStatus } = await import('../bootstrap.js');
    const status = getBootstrapStatus('/tmp/workspace');
    expect(status.status).toBe('synthesis_unavailable');
    expect(status.synthesis?.synthesisMode).toBe('structural-only');
    expect(status.synthesis?.synthesisUnavailableReason).toMatch(/nested claude code session/i);
  });
});
