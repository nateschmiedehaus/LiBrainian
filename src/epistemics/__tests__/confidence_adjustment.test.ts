import { describe, expect, it } from 'vitest';
import type { LiBrainianStorage } from '../../storage/types.js';
import { bounded } from '../confidence.js';
import { adjustConfidenceValue } from '../confidence.js';
import { computeCalibrationCurve, buildCalibrationReport } from '../calibration.js';
import { createClaimOutcomeTracker } from '../outcomes.js';

class MockStorage implements Pick<LiBrainianStorage, 'getState' | 'setState'> {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('confidence adjustment', () => {
  it('adjusts confidence values using calibration curves', () => {
    const curve = computeCalibrationCurve(
      [
        { confidence: 0.2, outcome: 0 },
        { confidence: 0.2, outcome: 1 },
        { confidence: 0.8, outcome: 1 },
        { confidence: 0.8, outcome: 1 },
        { confidence: 0.8, outcome: 0 },
      ],
      { bucketCount: 2 }
    );

    const report = buildCalibrationReport('dataset_adjustment', curve, new Date('2026-01-26T00:00:00Z'));
    const result = adjustConfidenceValue(
      bounded(0.7, 0.9, 'theoretical', 'test_basis'),
      report,
      { minSamplesForAdjustment: 1, minSamplesForFullWeight: 3 }
    );

    expect(result.confidence.type).toBe('derived');
    expect(result.raw).toBeCloseTo(0.8, 4);
    expect(result.calibrated).toBeCloseTo(2 / 3, 3);
    expect(result.status).toBe('calibrated');
  });

  it('integrates adjustment with outcome tracking', async () => {
    const storage = new MockStorage();
    const tracker = createClaimOutcomeTracker(storage as unknown as LiBrainianStorage);

    const { record: claimHigh } = await tracker.recordClaim({
      claim: 'high confidence claim',
      claimType: 'behavioral',
      statedConfidence: bounded(0.7, 0.9, 'theoretical', 'static_analysis'),
      category: 'behavior',
    });

    const { record: claimLow } = await tracker.recordClaim({
      claim: 'low confidence claim',
      claimType: 'behavioral',
      statedConfidence: bounded(0.1, 0.3, 'theoretical', 'static_analysis'),
      category: 'behavior',
    });

    await tracker.recordOutcome({
      claimId: claimHigh.id,
      outcome: 'correct',
      verifiedBy: 'automated_test',
      observation: 'passed',
    });

    await tracker.recordOutcome({
      claimId: claimLow.id,
      outcome: 'incorrect',
      verifiedBy: 'automated_test',
      observation: 'failed',
    });

    const adjustment = await tracker.adjustConfidence(
      bounded(0.7, 0.9, 'theoretical', 'static_analysis'),
      { bucketCount: 2, minSamplesForAdjustment: 1, minSamplesForFullWeight: 1 }
    );

    expect(adjustment.confidence.type).toBe('derived');
    expect(adjustment.calibrated).toBeCloseTo(1, 4);
    expect(adjustment.status).toBe('calibrated');
  });
});
