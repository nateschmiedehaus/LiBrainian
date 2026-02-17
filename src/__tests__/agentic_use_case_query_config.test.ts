import { describe, expect, it } from 'vitest';
import { createAgenticUseCaseQuery } from '../evaluation/agentic_use_case_review.js';

describe('createAgenticUseCaseQuery', () => {
  it('enforces strict release-safe query defaults', () => {
    const query = createAgenticUseCaseQuery({
      intent: 'UC-018: Map runtime topology',
      deterministicQueries: true,
      queryTimeoutMs: 180000,
    });

    expect(query.intent).toContain('UC-018');
    expect(query.depth).toBe('L1');
    expect(query.llmRequirement).toBe('required');
    expect(query.embeddingRequirement).toBe('required');
    expect(query.disableCache).toBe(true);
    expect(query.includeEngines).toBe(false);
    expect(query.disableMethodGuidance).toBe(true);
    expect(query.forceSummarySynthesis).toBe(true);
    expect(query.timeoutMs).toBe(180000);
    expect(query.deterministic).toBe(true);
  });
});
