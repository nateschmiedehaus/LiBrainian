import { describe, expect, it } from 'vitest';
import { detectStrictSignals } from '../evaluation/agentic_use_case_review.js';

describe('agentic use-case strict signal filtering', () => {
  it('ignores non-fatal adequacy/watch unverified markers', () => {
    const signals = detectStrictSignals({
      disclosures: [
        'unverified_by_trace(adequacy_missing): missing endpoint docs',
        'unverified_by_trace(multi_agent_conflict): key-123',
        'watch_state_missing: watch state unavailable',
      ],
    });
    expect(signals).toEqual([]);
  });

  it('keeps strict provider unverified markers', () => {
    const signals = detectStrictSignals({
      disclosures: [
        'unverified_by_trace(provider_unavailable): codex unavailable',
      ],
    });
    expect(signals).toContain('unverified_by_trace');
    expect(signals).toContain('provider_unavailable');
  });
});
