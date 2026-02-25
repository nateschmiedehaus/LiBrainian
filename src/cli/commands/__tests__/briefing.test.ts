import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateAmbientBriefingMock } = vi.hoisted(() => ({
  generateAmbientBriefingMock: vi.fn(),
}));

vi.mock('../../../api/ambient_briefing.js', () => ({
  generateAmbientBriefing: generateAmbientBriefingMock,
}));

import { briefingCommand } from '../briefing.js';

describe('briefingCommand', () => {
  const workspace = '/tmp/workspace';
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    generateAmbientBriefingMock.mockResolvedValue({
      scope: 'src/auth',
      tier: 'standard',
      tokenBudget: 500,
      tokenCount: 220,
      purpose: 'auth purpose',
      conventions: ['convention'],
      dependencies: { dependsOn: ['jsonwebtoken'], dependedOnBy: ['src/api/routes.ts'] },
      recentChanges: ['a1b2c3 2026-02-25 add auth'],
      testCoverage: {
        relatedTests: ['src/auth/__tests__/jwt.test.ts'],
        sourceFileCount: 2,
        testFileCount: 1,
        coverageSignal: '1 related test files for 2 source files.',
      },
      markdown: '# Ambient Briefing: src/auth',
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints markdown briefing by default', async () => {
    await briefingCommand({
      workspace,
      args: [],
      rawArgs: ['briefing', 'src/auth'],
    });

    expect(generateAmbientBriefingMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: workspace,
      scopePath: 'src/auth',
      tier: 'standard',
    }));
    expect(logSpy).toHaveBeenCalledWith('# Ambient Briefing: src/auth');
  });

  it('emits JSON when --json is provided', async () => {
    await briefingCommand({
      workspace,
      args: [],
      rawArgs: ['briefing', 'src/auth', '--json', '--tier', 'micro'],
    });

    const payload = String(logSpy.mock.calls[0]?.[0] ?? '');
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(generateAmbientBriefingMock).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'micro',
    }));
  });

  it('rejects invalid tier values', async () => {
    await expect(briefingCommand({
      workspace,
      args: [],
      rawArgs: ['briefing', 'src/auth', '--tier', 'invalid'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
