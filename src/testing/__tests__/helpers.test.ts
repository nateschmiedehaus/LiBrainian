import { describe, expect, it } from 'vitest';
import { ConstructionError } from '../../constructions/base/construction_base.js';
import { deterministic } from '../../epistemics/confidence.js';
import { fail, ok } from '../../constructions/types.js';
import {
  constructionFixture,
  mockCalibrationTracker,
  mockLedger,
  mockLibrarianContext,
  testConstruction,
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

  it('executes construction fixtures with testConstruction helper', async () => {
    const construction = {
      execute: async (input: { target: string }) =>
        ok({
          output: `analyzed:${input.target}`,
          confidence: deterministic(true, 'fixture-based test'),
          evidenceRefs: [],
          analysisTimeMs: 0,
        }),
    };

    const result = await testConstruction(construction, {
      fixture: 'tests/fixtures/sample-ts-project',
      input: { target: 'src/auth/validator.ts' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.output).toBe('analyzed:src/auth/validator.ts');
      expect(result.confidence).toBe(1);
      expect(result.fixture).toBe('tests/fixtures/sample-ts-project');
    }
  });

  it('surfaces typed construction errors from testConstruction helper', async () => {
    const error = new ConstructionError('construction failed', 'test-construction');
    const construction = {
      execute: async () => fail(error),
    };

    const result = await testConstruction(construction, {
      input: { value: 1 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });
});
