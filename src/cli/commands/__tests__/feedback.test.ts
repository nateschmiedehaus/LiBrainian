import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn().mockResolvedValue('/tmp/librarian.sqlite'),
}));

const initialize = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn().mockReturnValue({
    initialize,
    close,
  }),
}));

vi.mock('../../../integration/agent_protocol.js', () => ({
  submitQueryFeedback: vi.fn().mockResolvedValue({
    success: true,
    adjustmentsApplied: 2,
  }),
}));

describe('feedbackCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('requires feedbackToken and outcome', async () => {
    const { feedbackCommand } = await import('../feedback.js');

    await expect(feedbackCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['feedback', '--outcome', 'success'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(feedbackCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['feedback', 'fbk_123'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('submits feedback with outcome-level defaults', async () => {
    const { feedbackCommand } = await import('../feedback.js');
    const { submitQueryFeedback } = await import('../../../integration/agent_protocol.js');

    await feedbackCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['feedback', 'fbk_123', '--outcome', 'success'],
    });

    expect(submitQueryFeedback).toHaveBeenCalledWith(
      'fbk_123',
      'success',
      expect.any(Object),
      {
        agentId: undefined,
        missingContext: undefined,
        customRatings: undefined,
      }
    );
    expect(logSpy).toHaveBeenCalledWith('Feedback submitted (fbk_123)');
  });

  it('supports per-pack ratings via --ratings JSON', async () => {
    const { feedbackCommand } = await import('../feedback.js');
    const { submitQueryFeedback } = await import('../../../integration/agent_protocol.js');

    await feedbackCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: [
        'feedback',
        'fbk_123',
        '--outcome',
        'partial',
        '--ratings',
        '[{"packId":"pack-1","relevant":true,"usefulness":0.8}]',
      ],
    });

    expect(submitQueryFeedback).toHaveBeenCalledWith(
      'fbk_123',
      'partial',
      expect.any(Object),
      {
        agentId: undefined,
        missingContext: undefined,
        customRatings: [{ packId: 'pack-1', relevant: true, usefulness: 0.8, reason: undefined }],
      }
    );
  });

  it('emits JSON output in --json mode', async () => {
    const { feedbackCommand } = await import('../feedback.js');

    await feedbackCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['feedback', 'fbk_123', '--outcome', 'failure', '--json'],
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('{'));
    expect(output).toBeDefined();
    expect(output).toContain('"feedbackToken": "fbk_123"');
    expect(output).toContain('"success": true');
  });

  it('fails with actionable error when token is unknown', async () => {
    const { feedbackCommand } = await import('../feedback.js');
    const { submitQueryFeedback } = await import('../../../integration/agent_protocol.js');

    vi.mocked(submitQueryFeedback).mockResolvedValueOnce({
      success: false,
      adjustmentsApplied: 0,
      error: 'Unknown feedbackToken: fbk_missing',
    });

    await expect(feedbackCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['feedback', 'fbk_missing', '--outcome', 'failure'],
    })).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
  });
});
