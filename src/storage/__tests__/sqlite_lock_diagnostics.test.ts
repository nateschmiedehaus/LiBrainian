import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const logWarningMock = vi.hoisted(() => vi.fn());

vi.mock('../../telemetry/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../telemetry/logger.js')>();
  return {
    ...actual,
    logWarning: logWarningMock,
  };
});

describe('sqlite lock diagnostic dedupe', () => {
  let testing: typeof import('../sqlite_storage.js')['__testing'] | null = null;

  beforeEach(async () => {
    if (!testing) {
      ({ __testing: testing } = await import('../sqlite_storage.js'));
    }
    logWarningMock.mockReset();
    const helpers = testing!;
    helpers.resetLockDiagnosticState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    testing?.flushAllLockDiagnostics();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('logs first lock diagnostic immediately and summarizes duplicates once the burst settles', () => {
    const { emitLockDiagnostic, LOCK_DIAGNOSTIC_FLUSH_DELAY_MS } = testing!;
    const context = { path: '/tmp/librarian.sqlite.lock', actions: ['removed_lock'] };

    emitLockDiagnostic('Recovered stale storage lock state; retrying lock acquisition', context);
    emitLockDiagnostic('Recovered stale storage lock state; retrying lock acquisition', context);
    emitLockDiagnostic('Recovered stale storage lock state; retrying lock acquisition', context);

    expect(logWarningMock).toHaveBeenCalledTimes(1);
    expect(logWarningMock).toHaveBeenCalledWith(
      'Recovered stale storage lock state; retrying lock acquisition',
      context,
    );

    vi.advanceTimersByTime(LOCK_DIAGNOSTIC_FLUSH_DELAY_MS);

    expect(logWarningMock).toHaveBeenCalledTimes(2);
    const [summaryMessage, summaryContext] = logWarningMock.mock.calls[1];
    expect(summaryMessage).toContain('SQLite lock contention persisted');
    expect(summaryContext).toMatchObject({
      suppressedDuplicates: 2,
      path: '/tmp/librarian.sqlite.lock',
    });
    expect(String(summaryContext?.remediation ?? '')).toContain('librarian doctor --heal');
  });

  it('does not emit a summary when there is only a single diagnostic event', () => {
    const { emitLockDiagnostic, LOCK_DIAGNOSTIC_FLUSH_DELAY_MS } = testing!;
    emitLockDiagnostic('Proactive lock recovery check failed, proceeding with acquisition', { path: '/tmp/db.lock' });

    vi.advanceTimersByTime(LOCK_DIAGNOSTIC_FLUSH_DELAY_MS);

    expect(logWarningMock).toHaveBeenCalledTimes(1);
    const [message] = logWarningMock.mock.calls[0];
    expect(message).toBe('Proactive lock recovery check failed, proceeding with acquisition');
  });
});
