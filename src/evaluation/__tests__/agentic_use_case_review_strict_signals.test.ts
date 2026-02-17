import { describe, expect, it } from 'vitest';
import { detectStrictSignals } from '../agentic_use_case_review.js';

describe('detectStrictSignals', () => {
  it('does not flag fallback when marker keys are false', () => {
    const signals = detectStrictSignals({
      diagnostics: {
        fallbackUsed: false,
        degraded: false,
        retryAttempted: false,
      },
    });
    expect(signals).toEqual([]);
  });

  it('flags fallback when marker key is true', () => {
    const signals = detectStrictSignals({
      diagnostics: {
        fallbackUsed: true,
      },
    });
    expect(signals).toContain('fallback');
  });

  it('flags explicit strict marker strings', () => {
    const signals = detectStrictSignals({
      errors: [
        'unverified_by_trace(provider_unavailable): codex unavailable',
        'operation timeout after 120000ms',
      ],
    });
    expect(signals).toContain('unverified_by_trace');
    expect(signals).toContain('provider_unavailable');
    expect(signals).toContain('timeout');
  });
});
