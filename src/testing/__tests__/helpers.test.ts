import { describe, expect, it } from 'vitest';
import {
  constructionFixture,
  mockCalibrationTracker,
  mockLedger,
  mockLibrarianContext,
} from '../index.js';

describe('testing helpers', () => {
  it('creates deterministic librarian context with overrides', () => {
    const context = mockLibrarianContext(
      { librarian: { query: async () => ({ summary: 'ok' }) } },
      { sessionId: 'abc' },
    );
    expect(context.sessionId).toBe('abc');
    expect(context.deps.librarian).toBeTruthy();
    expect(context.signal).toBeInstanceOf(AbortSignal);
  });

  it('stores and queries entries in mock ledger', async () => {
    const ledger = mockLedger<{ claim: string }>();
    await ledger.append({ claim: 'A' });
    await ledger.append({ claim: 'B' });
    expect(ledger.size()).toBe(2);

    const matches = await ledger.query((entry) => entry.entry.claim === 'B');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.entry.claim).toBe('B');
  });

  it('returns deterministic calibration score', () => {
    const tracker = mockCalibrationTracker();
    expect(tracker.calibrate(0.1)).toBe(0.8);
    tracker.set(0.92);
    expect(tracker.calibrate(0.1)).toBe(0.92);
  });

  it('creates constant and functional construction fixtures', async () => {
    const constant = constructionFixture<string, number>('const', 7);
    const dynamic = constructionFixture<number, number>('dynamic', async (n) => n * 2);

    await expect(constant.execute('ignored')).resolves.toBe(7);
    await expect(dynamic.execute(4)).resolves.toBe(8);
  });
});
