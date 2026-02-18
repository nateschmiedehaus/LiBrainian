import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLibrarianMock = vi.fn();

vi.mock('../first_run_gate.js', () => ({
  getLibrarian: getLibrarianMock,
  ensureLibrarianReady: vi.fn(),
  isLibrarianReady: vi.fn(),
}));

vi.mock('../../events.js', () => ({
  globalEventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  createTaskReceivedEvent: vi.fn(() => ({})),
  createIntegrationContextEvent: vi.fn(() => ({})),
  createTaskCompletedEvent: vi.fn(() => ({})),
  createTaskFailedEvent: vi.fn(() => ({})),
  createConfidenceUpdatedEvent: vi.fn(() => ({})),
  createContextPacksInvalidatedEvent: vi.fn(() => ({})),
  createFileModifiedEvent: vi.fn(() => ({})),
  createFeedbackReceivedEvent: vi.fn(() => ({})),
  createIntegrationOutcomeEvent: vi.fn(() => ({})),
}));

describe('enrichTaskContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves relative affected files against workspace root', async () => {
    const queryOptional = vi.fn().mockResolvedValue({
      query: { intent: 'test intent', taskType: 'bug_fix' },
      packs: [],
      totalConfidence: 0.5,
      drillDownHints: [],
      methodHints: [],
    });
    getLibrarianMock.mockReturnValue({ queryOptional });

    const { enrichTaskContext } = await import('../wave0_integration.js');
    const workspace = '/tmp/workspace';
    const relative = 'src/app.ts';
    const absolute = '/tmp/workspace/src/other.ts';

    await enrichTaskContext(workspace, {
      intent: 'test intent',
      taskType: 'bug_fix',
      affectedFiles: [relative, absolute],
    });

    const call = queryOptional.mock.calls[0]?.[0];
    expect(call.affectedFiles).toEqual([
      path.resolve(workspace, relative),
      absolute,
    ]);
  });
});
