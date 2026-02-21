import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LiBrainianStorage } from '../../storage/types.js';
import { SqliteEvidenceLedger } from '../evidence_ledger.js';
import { createClaimOutcomeTracker } from '../outcomes.js';
import { bounded } from '../confidence.js';

class MockStorage implements Pick<LiBrainianStorage, 'getState' | 'setState'> {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('claim outcome tracking', () => {
  let ledger: SqliteEvidenceLedger;

  beforeEach(async () => {
    ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
  });

  afterEach(async () => {
    await ledger.close();
  });

  it('records claim and outcome with ledger linkage', async () => {
    const storage = new MockStorage();
    const tracker = createClaimOutcomeTracker(storage as unknown as LiBrainianStorage, { ledger });

    const { record: claimRecord, ledgerEntry: claimEntry } = await tracker.recordClaim({
      claim: 'processData is pure',
      claimType: 'behavioral',
      statedConfidence: bounded(0.6, 0.8, 'theoretical', 'static_analysis'),
      context: 'function processData(input: string): string { return input.trim(); }',
      subjectId: 'src/utils.ts::processData',
      subjectType: 'function',
      category: 'behavior',
      source: 'unit_test',
    });

    expect(claimRecord.id).toBeTruthy();
    expect(claimRecord.contextHash).toHaveLength(16);
    expect(claimEntry?.kind).toBe('claim');

    const { record: outcomeRecord, ledgerEntry: outcomeEntry } = await tracker.recordOutcome({
      claimId: claimRecord.id,
      outcome: 'correct',
      verifiedBy: 'automated_test',
      observation: 'Unit tests confirm no side effects',
    });

    expect(outcomeRecord.claimId).toBe(claimRecord.id);
    expect(outcomeEntry?.kind).toBe('outcome');
    expect(outcomeEntry?.relatedEntries).toContain(claimEntry?.id);

    const outcomes = await tracker.listOutcomes(claimRecord.id);
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.outcome).toBe('correct');

    const ledgerEntries = await ledger.query({ kinds: ['claim', 'outcome'] });
    expect(ledgerEntries.length).toBe(2);
  });

  it('rejects outcomes for unknown claims', async () => {
    const storage = new MockStorage();
    const tracker = createClaimOutcomeTracker(storage as unknown as LiBrainianStorage, { ledger });

    await expect(tracker.recordOutcome({
      claimId: 'missing',
      outcome: 'incorrect',
      verifiedBy: 'human',
      observation: 'No evidence found',
    })).rejects.toThrow('claim_outcome_missing_claim');
  });
});
