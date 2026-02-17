import { describe, expect, it } from 'vitest';
import { classifyGateReasons, countByCategory, countBySeverity } from '../reason_taxonomy.js';

describe('reason taxonomy', () => {
  it('classifies dependency and sample-size reasons separately', () => {
    const reasons = [
      'provider_prerequisite_failures_detected',
      't3_plus_significance_sample_insufficient',
      't3_plus_lift_below_threshold:0.100<0.250',
    ];
    const classified = classifyGateReasons(reasons);

    expect(classified.map((entry) => entry.category)).toEqual(['dependency', 'sample_size', 'quality']);
    expect(countBySeverity(classified).dependency).toBe(1);
    expect(countBySeverity(classified).sample_size).toBe(1);
  });

  it('defaults unknown reasons to informational/other', () => {
    const classified = classifyGateReasons(['custom_reason_123']);
    expect(classified[0]?.severity).toBe('informational');
    expect(classified[0]?.category).toBe('other');
    expect(countByCategory(classified).other).toBe(1);
  });

  it('classifies artifact-integrity reasons as blocking execution risks', () => {
    const reasons = [
      'journey_artifact_integrity_failures_detected',
      'smoke_artifact_integrity_failures_detected',
      'artifact_integrity_share_below_threshold:0.500<1.000',
    ];
    const classified = classifyGateReasons(reasons);

    expect(classified.map((entry) => entry.category)).toEqual(['execution', 'execution', 'execution']);
    expect(countBySeverity(classified).blocking).toBe(3);
  });

  it('classifies smoke repo timeout reasons as blocking execution risks', () => {
    const reasons = ['unverified_by_trace(smoke_repo_timeout): reccmp-py exceeded 120000ms'];
    const classified = classifyGateReasons(reasons);

    expect(classified[0]?.category).toBe('execution');
    expect(classified[0]?.severity).toBe('blocking');
  });

  it('classifies fallback-share and journey fallback reasons as quality risks', () => {
    const reasons = [
      'verification_fallback_share_above_threshold:0.500>0.000',
      'journey_fallback_context_detected',
      'journey_unverified_trace_errors:2',
    ];
    const classified = classifyGateReasons(reasons);

    expect(classified.map((entry) => entry.category)).toEqual(['quality', 'quality', 'quality']);
    expect(countBySeverity(classified).quality).toBe(3);
  });

  it('classifies verification fallback configuration as blocking execution risk', () => {
    const classified = classifyGateReasons(['verification_fallback_disallowed']);
    expect(classified[0]?.category).toBe('execution');
    expect(classified[0]?.severity).toBe('blocking');
  });
});
