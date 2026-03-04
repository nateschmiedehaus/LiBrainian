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

describe('resolveSynthesisAvailability', () => {
  beforeEach(() => {
    vi.resetModules();
    restoreEnv(envSnapshot);
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('returns structural-only when nested Claude session markers are present', async () => {
    process.env.CLAUDE_CODE_SESSION = '1';
    const { resolveSynthesisAvailability } = await import('../llm_env.js');
    const availability = resolveSynthesisAvailability();
    expect(availability.synthesisMode).toBe('structural-only');
    expect(availability.synthesisUnavailableReason).toMatch(/Nested Claude Code session/);
  });

  it('returns llm mode when no nested markers are set', async () => {
    const { resolveSynthesisAvailability } = await import('../llm_env.js');
    const availability = resolveSynthesisAvailability();
    expect(availability).toEqual({ synthesisMode: 'llm' });
  });
});
