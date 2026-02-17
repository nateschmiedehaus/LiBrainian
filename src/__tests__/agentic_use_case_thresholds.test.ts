import { describe, expect, it } from 'vitest';
import { resolveReviewThresholds } from '../evaluation/agentic_use_case_review.js';

describe('resolveReviewThresholds', () => {
  it('keeps defaults when override keys are undefined', () => {
    const thresholds = resolveReviewThresholds({
      minPassRate: undefined,
      minEvidenceRate: undefined,
      minUsefulSummaryRate: undefined,
      maxStrictFailureShare: undefined,
      minPrerequisitePassRate: undefined,
      minTargetPassRate: undefined,
      minTargetDependencyReadyShare: undefined,
    });

    expect(thresholds.minPassRate).toBe(0.75);
    expect(thresholds.minEvidenceRate).toBe(0.9);
    expect(thresholds.minUsefulSummaryRate).toBe(0.8);
    expect(thresholds.maxStrictFailureShare).toBe(0);
    expect(thresholds.minPrerequisitePassRate).toBe(0.75);
    expect(thresholds.minTargetPassRate).toBe(0.75);
    expect(thresholds.minTargetDependencyReadyShare).toBe(1);
  });
});
