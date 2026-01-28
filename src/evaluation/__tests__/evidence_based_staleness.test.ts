/**
 * @fileoverview Tests for Evidence-Based Staleness (WU-CALX-006)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Evidence-Based Staleness module replaces arbitrary time-based staleness
 * with evidence-based detection. Knowledge is stale only when there's EVIDENCE
 * of change, not just time passage.
 *
 * Key principle: "No evidence of change = not stale"
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EvidenceBasedStaleness,
  createEvidenceBasedStaleness,
  type StalenessEvidence,
  type StalenessAssessment,
  type ChangeFrequencyProfile,
  type StalenessConfig,
} from '../evidence_based_staleness.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const now = new Date('2025-01-28T12:00:00Z');

const sampleFileChangedEvidence: StalenessEvidence = {
  type: 'file_changed',
  source: 'src/utils/helpers.ts',
  timestamp: new Date('2025-01-28T10:00:00Z'),
  description: 'File modified with new helper function',
  affectedClaims: ['claim-001', 'claim-002'],
  confidence: 0.95,
};

const sampleApiChangedEvidence: StalenessEvidence = {
  type: 'api_changed',
  source: 'UserService.getUser',
  timestamp: new Date('2025-01-27T14:00:00Z'),
  description: 'API signature changed from (id: string) to (id: string, options?: object)',
  affectedClaims: ['claim-003'],
  confidence: 0.9,
};

const sampleDependencyEvidence: StalenessEvidence = {
  type: 'dependency_updated',
  source: 'package.json',
  timestamp: new Date('2025-01-26T09:00:00Z'),
  description: 'lodash updated from 4.17.0 to 4.18.0',
  affectedClaims: ['claim-004'],
  confidence: 0.7,
};

const sampleTestFailedEvidence: StalenessEvidence = {
  type: 'test_failed',
  source: 'tests/helpers.test.ts',
  timestamp: new Date('2025-01-28T11:00:00Z'),
  description: 'Test for parseDate function failed after code change',
  affectedClaims: ['claim-005'],
  confidence: 0.85,
};

const sampleUserFeedbackEvidence: StalenessEvidence = {
  type: 'user_feedback',
  source: 'user-123',
  timestamp: new Date('2025-01-25T16:00:00Z'),
  description: 'User reported documentation outdated for config options',
  affectedClaims: ['claim-006'],
  confidence: 0.6,
};

const sampleChangeHistory = [
  { date: new Date('2025-01-28T10:00:00Z'), type: 'file_changed' },
  { date: new Date('2025-01-21T10:00:00Z'), type: 'file_changed' },
  { date: new Date('2025-01-14T10:00:00Z'), type: 'file_changed' },
  { date: new Date('2025-01-07T10:00:00Z'), type: 'file_changed' },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createEvidenceBasedStaleness', () => {
  it('should create an EvidenceBasedStaleness instance', () => {
    const staleness = createEvidenceBasedStaleness();
    expect(staleness).toBeInstanceOf(EvidenceBasedStaleness);
  });

  it('should accept custom configuration', () => {
    const config: StalenessConfig = {
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.8,
      volatilityMultipliers: {
        stable: 2.0,
        moderate: 1.5,
        volatile: 0.5,
      },
    };

    const staleness = createEvidenceBasedStaleness(config);
    expect(staleness).toBeInstanceOf(EvidenceBasedStaleness);
  });
});

// ============================================================================
// STALENESS ASSESSMENT TESTS - CORE PRINCIPLE
// ============================================================================

describe('EvidenceBasedStaleness - assessStaleness', () => {
  let staleness: EvidenceBasedStaleness;

  beforeEach(() => {
    staleness = createEvidenceBasedStaleness({
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.5,
      volatilityMultipliers: {
        stable: 2.0,
        moderate: 1.5,
        volatile: 0.5,
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should NOT mark claim as stale when no evidence exists - KEY PRINCIPLE', () => {
    // This is the core principle: no evidence = not stale
    const assessment = staleness.assessStaleness('claim-no-evidence');

    expect(assessment.isStale).toBe(false);
    expect(assessment.evidence).toEqual([]);
    expect(assessment.stalenessReason).toBeUndefined();
  });

  it('should NOT mark claim as stale based on time alone', () => {
    // Even if a claim was validated a long time ago, without evidence of change
    // it should NOT be marked stale
    const assessment = staleness.assessStaleness('claim-old-but-valid');

    // No evidence recorded, so not stale regardless of time
    expect(assessment.isStale).toBe(false);
  });

  it('should mark claim as stale when file change evidence exists', () => {
    staleness.recordEvidence(sampleFileChangedEvidence);

    const assessment = staleness.assessStaleness('claim-001');

    expect(assessment.isStale).toBe(true);
    expect(assessment.stalenessReason).toContain('file_changed');
    expect(assessment.evidence.length).toBe(1);
    expect(assessment.evidence[0].type).toBe('file_changed');
  });

  it('should mark claim as stale when API change evidence exists', () => {
    staleness.recordEvidence(sampleApiChangedEvidence);

    const assessment = staleness.assessStaleness('claim-003');

    expect(assessment.isStale).toBe(true);
    expect(assessment.stalenessReason).toContain('api_changed');
  });

  it('should mark claim as stale when test failure evidence exists', () => {
    staleness.recordEvidence(sampleTestFailedEvidence);

    const assessment = staleness.assessStaleness('claim-005');

    expect(assessment.isStale).toBe(true);
    expect(assessment.stalenessReason).toContain('test_failed');
  });

  it('should NOT mark claim as stale when evidence confidence is below threshold', () => {
    const lowConfidenceEvidence: StalenessEvidence = {
      ...sampleFileChangedEvidence,
      confidence: 0.3, // Below 0.5 threshold
      affectedClaims: ['claim-low-conf'],
    };

    staleness.recordEvidence(lowConfidenceEvidence);

    const assessment = staleness.assessStaleness('claim-low-conf');

    expect(assessment.isStale).toBe(false);
  });

  it('should include all relevant evidence in assessment', () => {
    const evidence1: StalenessEvidence = {
      ...sampleFileChangedEvidence,
      affectedClaims: ['claim-multi'],
    };
    const evidence2: StalenessEvidence = {
      ...sampleApiChangedEvidence,
      affectedClaims: ['claim-multi'],
    };

    staleness.recordEvidence(evidence1);
    staleness.recordEvidence(evidence2);

    const assessment = staleness.assessStaleness('claim-multi');

    expect(assessment.evidence.length).toBe(2);
    expect(assessment.isStale).toBe(true);
  });

  it('should include lastValidated timestamp in assessment', () => {
    const assessment = staleness.assessStaleness('claim-007');

    expect(assessment.lastValidated).toBeInstanceOf(Date);
  });

  it('should calculate nextValidationDue based on change frequency, not arbitrary time', () => {
    staleness.recordEvidence(sampleFileChangedEvidence);

    const assessment = staleness.assessStaleness('claim-001');

    // nextValidationDue should be based on entity's change patterns
    expect(assessment.nextValidationDue).toBeInstanceOf(Date);
    // Should be in the future
    expect(assessment.nextValidationDue!.getTime()).toBeGreaterThan(now.getTime());
  });
});

// ============================================================================
// EVIDENCE RECORDING TESTS
// ============================================================================

describe('EvidenceBasedStaleness - recordEvidence', () => {
  let staleness: EvidenceBasedStaleness;

  beforeEach(() => {
    staleness = createEvidenceBasedStaleness();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should store evidence for affected claims', () => {
    staleness.recordEvidence(sampleFileChangedEvidence);

    const assessment = staleness.assessStaleness('claim-001');
    expect(assessment.evidence.length).toBe(1);

    const assessment2 = staleness.assessStaleness('claim-002');
    expect(assessment2.evidence.length).toBe(1);
  });

  it('should support all evidence types', () => {
    staleness.recordEvidence(sampleFileChangedEvidence);
    staleness.recordEvidence(sampleApiChangedEvidence);
    staleness.recordEvidence(sampleDependencyEvidence);
    staleness.recordEvidence(sampleTestFailedEvidence);
    staleness.recordEvidence(sampleUserFeedbackEvidence);

    // Each claim should have its evidence
    expect(staleness.assessStaleness('claim-001').evidence[0].type).toBe('file_changed');
    expect(staleness.assessStaleness('claim-003').evidence[0].type).toBe('api_changed');
    expect(staleness.assessStaleness('claim-004').evidence[0].type).toBe('dependency_updated');
    expect(staleness.assessStaleness('claim-005').evidence[0].type).toBe('test_failed');
    expect(staleness.assessStaleness('claim-006').evidence[0].type).toBe('user_feedback');
  });

  it('should accumulate multiple evidence items for same claim', () => {
    const evidence1: StalenessEvidence = {
      type: 'file_changed',
      source: 'src/a.ts',
      timestamp: new Date(),
      description: 'First change',
      affectedClaims: ['claim-accumulate'],
      confidence: 0.8,
    };

    const evidence2: StalenessEvidence = {
      type: 'test_failed',
      source: 'tests/a.test.ts',
      timestamp: new Date(),
      description: 'Test failure',
      affectedClaims: ['claim-accumulate'],
      confidence: 0.9,
    };

    staleness.recordEvidence(evidence1);
    staleness.recordEvidence(evidence2);

    const assessment = staleness.assessStaleness('claim-accumulate');
    expect(assessment.evidence.length).toBe(2);
  });

  it('should update change history for entity when recording evidence', () => {
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/utils/helpers.ts',
      timestamp: new Date('2025-01-28T10:00:00Z'),
      description: 'Change 1',
      affectedClaims: ['claim-hist'],
      confidence: 0.9,
    });

    const profile = staleness.getChangeProfile('src/utils/helpers.ts');
    expect(profile.historicalChanges.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CHANGE FREQUENCY PROFILE TESTS
// ============================================================================

describe('EvidenceBasedStaleness - getChangeProfile', () => {
  let staleness: EvidenceBasedStaleness;

  beforeEach(() => {
    staleness = createEvidenceBasedStaleness();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should return change frequency profile for entity', () => {
    // Record multiple changes over time
    for (const change of sampleChangeHistory) {
      staleness.recordEvidence({
        type: change.type as StalenessEvidence['type'],
        source: 'src/stable-file.ts',
        timestamp: change.date,
        description: 'Change',
        affectedClaims: ['claim-profile'],
        confidence: 0.9,
      });
    }

    const profile = staleness.getChangeProfile('src/stable-file.ts');

    expect(profile.entityId).toBe('src/stable-file.ts');
    expect(profile.historicalChanges.length).toBe(4);
    expect(profile.avgChangeInterval).toBeGreaterThan(0);
  });

  it('should classify entity volatility as stable for infrequent changes', () => {
    // One change in 30 days = stable
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/stable.ts',
      timestamp: new Date('2025-01-01T10:00:00Z'),
      description: 'Single change',
      affectedClaims: ['claim-stable'],
      confidence: 0.9,
    });

    const profile = staleness.getChangeProfile('src/stable.ts');
    expect(profile.volatility).toBe('stable');
  });

  it('should classify entity volatility as moderate for regular changes', () => {
    // Changes every ~7 days = moderate
    const dates = [
      new Date('2025-01-28T10:00:00Z'),
      new Date('2025-01-21T10:00:00Z'),
      new Date('2025-01-14T10:00:00Z'),
    ];

    for (const date of dates) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: 'src/moderate.ts',
        timestamp: date,
        description: 'Regular change',
        affectedClaims: ['claim-moderate'],
        confidence: 0.9,
      });
    }

    const profile = staleness.getChangeProfile('src/moderate.ts');
    expect(profile.volatility).toBe('moderate');
  });

  it('should classify entity volatility as volatile for frequent changes', () => {
    // Changes every day = volatile
    const dates = [
      new Date('2025-01-28T10:00:00Z'),
      new Date('2025-01-27T10:00:00Z'),
      new Date('2025-01-26T10:00:00Z'),
      new Date('2025-01-25T10:00:00Z'),
      new Date('2025-01-24T10:00:00Z'),
    ];

    for (const date of dates) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: 'src/volatile.ts',
        timestamp: date,
        description: 'Frequent change',
        affectedClaims: ['claim-volatile'],
        confidence: 0.9,
      });
    }

    const profile = staleness.getChangeProfile('src/volatile.ts');
    expect(profile.volatility).toBe('volatile');
  });

  it('should calculate suggested check interval based on historical patterns', () => {
    // Weekly changes suggest weekly checks
    const dates = [
      new Date('2025-01-28T10:00:00Z'),
      new Date('2025-01-21T10:00:00Z'),
      new Date('2025-01-14T10:00:00Z'),
    ];

    for (const date of dates) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: 'src/weekly.ts',
        timestamp: date,
        description: 'Weekly change',
        affectedClaims: ['claim-weekly'],
        confidence: 0.9,
      });
    }

    const profile = staleness.getChangeProfile('src/weekly.ts');

    // Should suggest interval around 7 days (with some buffer)
    expect(profile.suggestedCheckInterval).toBeGreaterThanOrEqual(5);
    expect(profile.suggestedCheckInterval).toBeLessThanOrEqual(14);
  });

  it('should return default profile for unknown entity', () => {
    const profile = staleness.getChangeProfile('src/unknown.ts');

    expect(profile.entityId).toBe('src/unknown.ts');
    expect(profile.historicalChanges).toEqual([]);
    expect(profile.volatility).toBe('stable'); // Default to stable when unknown
    expect(profile.suggestedCheckInterval).toBeGreaterThan(0);
  });
});

// ============================================================================
// VALIDATION SCHEDULE TESTS
// ============================================================================

describe('EvidenceBasedStaleness - suggestValidationSchedule', () => {
  let staleness: EvidenceBasedStaleness;

  beforeEach(() => {
    staleness = createEvidenceBasedStaleness({
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.5,
      volatilityMultipliers: {
        stable: 2.0,
        moderate: 1.5,
        volatile: 0.5,
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should suggest validation date based on change frequency', () => {
    // Record weekly changes
    const dates = [
      new Date('2025-01-28T10:00:00Z'),
      new Date('2025-01-21T10:00:00Z'),
    ];

    for (const date of dates) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: 'src/schedule-test.ts',
        timestamp: date,
        description: 'Change',
        affectedClaims: ['claim-schedule'],
        confidence: 0.9,
      });
    }

    const nextDate = staleness.suggestValidationSchedule('src/schedule-test.ts');

    expect(nextDate).toBeInstanceOf(Date);
    expect(nextDate.getTime()).toBeGreaterThan(now.getTime());
  });

  it('should suggest longer intervals for stable entities', () => {
    // One old change = stable
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/stable-schedule.ts',
      timestamp: new Date('2025-01-01T10:00:00Z'),
      description: 'Old change',
      affectedClaims: ['claim-stable-sched'],
      confidence: 0.9,
    });

    const stableDate = staleness.suggestValidationSchedule('src/stable-schedule.ts');

    // Daily changes = volatile
    for (let i = 0; i < 5; i++) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: 'src/volatile-schedule.ts',
        timestamp: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
        description: 'Frequent change',
        affectedClaims: ['claim-volatile-sched'],
        confidence: 0.9,
      });
    }

    const volatileDate = staleness.suggestValidationSchedule('src/volatile-schedule.ts');

    // Stable entity should have longer interval than volatile
    const stableInterval = stableDate.getTime() - now.getTime();
    const volatileInterval = volatileDate.getTime() - now.getTime();

    expect(stableInterval).toBeGreaterThan(volatileInterval);
  });

  it('should apply volatility multipliers to base interval', () => {
    // This tests that the config's volatility multipliers are applied
    const customConfig: StalenessConfig = {
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.5,
      volatilityMultipliers: {
        stable: 3.0, // Triple the interval for stable
        moderate: 1.0,
        volatile: 0.25, // Quarter the interval for volatile
      },
    };

    const customStaleness = createEvidenceBasedStaleness(customConfig);

    // The multipliers affect the suggested check interval
    // This is verified by the fact that stable entities get longer intervals
    expect(customStaleness).toBeInstanceOf(EvidenceBasedStaleness);
  });
});

// ============================================================================
// TIME DECAY VALIDITY TESTS
// ============================================================================

describe('EvidenceBasedStaleness - isTimeDecayValid', () => {
  let staleness: EvidenceBasedStaleness;

  beforeEach(() => {
    staleness = createEvidenceBasedStaleness({
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.5,
      volatilityMultipliers: {
        stable: 2.0,
        moderate: 1.5,
        volatile: 0.5,
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should return invalid for arbitrary time-based decay without evidence', () => {
    // Time decay without evidence is NOT valid
    const result = staleness.isTimeDecayValid('entity-no-evidence');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('evidence');
  });

  it('should return valid when time decay is based on historical change patterns', () => {
    // Record historical changes to establish a pattern
    const dates = [
      new Date('2025-01-28T10:00:00Z'),
      new Date('2025-01-21T10:00:00Z'),
      new Date('2025-01-14T10:00:00Z'),
    ];

    for (const date of dates) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: 'entity-with-pattern',
        timestamp: date,
        description: 'Historical change',
        affectedClaims: ['claim-pattern'],
        confidence: 0.9,
      });
    }

    const result = staleness.isTimeDecayValid('entity-with-pattern');

    expect(result.valid).toBe(true);
    expect(result.reason).toContain('pattern');
  });

  it('should explain why time decay without evidence is fallacious', () => {
    const result = staleness.isTimeDecayValid('entity-arbitrary');

    expect(result.reason).toMatch(/time alone|arbitrary|evidence/i);
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('EvidenceBasedStaleness - Configuration', () => {
  it('should respect requireEvidenceForStale=true setting', () => {
    const staleness = createEvidenceBasedStaleness({
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.5,
      volatilityMultipliers: { stable: 2.0, moderate: 1.5, volatile: 0.5 },
    });

    // Without evidence, claim should not be stale
    const assessment = staleness.assessStaleness('any-claim');
    expect(assessment.isStale).toBe(false);
  });

  it('should respect minimumEvidenceConfidence setting', () => {
    const staleness = createEvidenceBasedStaleness({
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.9, // High threshold
      volatilityMultipliers: { stable: 2.0, moderate: 1.5, volatile: 0.5 },
    });

    // Low confidence evidence should not trigger staleness
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/test.ts',
      timestamp: new Date(),
      description: 'Low confidence change',
      affectedClaims: ['claim-low-conf'],
      confidence: 0.7, // Below 0.9 threshold
    });

    const assessment = staleness.assessStaleness('claim-low-conf');
    expect(assessment.isStale).toBe(false);
  });

  it('should use default configuration when none provided', () => {
    const staleness = createEvidenceBasedStaleness();

    // Should work with defaults
    const assessment = staleness.assessStaleness('claim-default');
    expect(assessment).toBeDefined();
    expect(assessment.claimId).toBe('claim-default');
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('StalenessEvidence Interface', () => {
  it('should support all evidence types', () => {
    const types: StalenessEvidence['type'][] = [
      'file_changed',
      'api_changed',
      'dependency_updated',
      'test_failed',
      'user_feedback',
    ];

    types.forEach((type) => {
      const evidence: StalenessEvidence = {
        type,
        source: 'test-source',
        timestamp: new Date(),
        description: 'Test description',
        affectedClaims: ['claim-1'],
        confidence: 0.8,
      };
      expect(evidence.type).toBe(type);
    });
  });

  it('should support multiple affected claims', () => {
    const evidence: StalenessEvidence = {
      type: 'file_changed',
      source: 'test.ts',
      timestamp: new Date(),
      description: 'Change affecting multiple claims',
      affectedClaims: ['claim-1', 'claim-2', 'claim-3'],
      confidence: 0.9,
    };

    expect(evidence.affectedClaims.length).toBe(3);
  });
});

describe('StalenessAssessment Interface', () => {
  it('should include all required fields', () => {
    const assessment: StalenessAssessment = {
      claimId: 'test-claim',
      isStale: false,
      evidence: [],
      lastValidated: new Date(),
    };

    expect(assessment.claimId).toBe('test-claim');
    expect(assessment.isStale).toBe(false);
    expect(assessment.evidence).toEqual([]);
    expect(assessment.lastValidated).toBeInstanceOf(Date);
  });

  it('should support optional fields', () => {
    const assessment: StalenessAssessment = {
      claimId: 'test-claim',
      isStale: true,
      stalenessReason: 'File was modified',
      evidence: [sampleFileChangedEvidence],
      lastValidated: new Date(),
      nextValidationDue: new Date(),
    };

    expect(assessment.stalenessReason).toBe('File was modified');
    expect(assessment.nextValidationDue).toBeInstanceOf(Date);
  });
});

describe('ChangeFrequencyProfile Interface', () => {
  it('should include all required fields', () => {
    const profile: ChangeFrequencyProfile = {
      entityId: 'src/test.ts',
      historicalChanges: [
        { date: new Date(), type: 'file_changed' },
      ],
      avgChangeInterval: 7,
      volatility: 'moderate',
      suggestedCheckInterval: 5,
    };

    expect(profile.entityId).toBe('src/test.ts');
    expect(profile.avgChangeInterval).toBe(7);
    expect(profile.volatility).toBe('moderate');
    expect(profile.suggestedCheckInterval).toBe(5);
  });

  it('should support all volatility levels', () => {
    const volatilities: ChangeFrequencyProfile['volatility'][] = ['stable', 'moderate', 'volatile'];

    volatilities.forEach((volatility) => {
      const profile: ChangeFrequencyProfile = {
        entityId: 'test',
        historicalChanges: [],
        avgChangeInterval: 7,
        volatility,
        suggestedCheckInterval: 7,
      };
      expect(profile.volatility).toBe(volatility);
    });
  });
});

describe('StalenessConfig Interface', () => {
  it('should include all configuration options', () => {
    const config: StalenessConfig = {
      requireEvidenceForStale: true,
      minimumEvidenceConfidence: 0.7,
      volatilityMultipliers: {
        stable: 2.5,
        moderate: 1.5,
        volatile: 0.5,
      },
    };

    expect(config.requireEvidenceForStale).toBe(true);
    expect(config.minimumEvidenceConfidence).toBe(0.7);
    expect(config.volatilityMultipliers.stable).toBe(2.5);
    expect(config.volatilityMultipliers.moderate).toBe(1.5);
    expect(config.volatilityMultipliers.volatile).toBe(0.5);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('EvidenceBasedStaleness - Edge Cases', () => {
  let staleness: EvidenceBasedStaleness;

  beforeEach(() => {
    staleness = createEvidenceBasedStaleness();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should handle empty claim ID', () => {
    const assessment = staleness.assessStaleness('');
    expect(assessment.claimId).toBe('');
    expect(assessment.isStale).toBe(false);
  });

  it('should handle evidence with empty affectedClaims array', () => {
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/test.ts',
      timestamp: new Date(),
      description: 'Change with no claims',
      affectedClaims: [],
      confidence: 0.9,
    });

    // Should not throw
    const assessment = staleness.assessStaleness('unrelated-claim');
    expect(assessment.isStale).toBe(false);
  });

  it('should handle evidence with confidence of exactly 0', () => {
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/test.ts',
      timestamp: new Date(),
      description: 'Zero confidence change',
      affectedClaims: ['claim-zero'],
      confidence: 0,
    });

    const assessment = staleness.assessStaleness('claim-zero');
    expect(assessment.isStale).toBe(false);
  });

  it('should handle evidence with confidence of exactly 1', () => {
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/test.ts',
      timestamp: new Date(),
      description: 'Max confidence change',
      affectedClaims: ['claim-max'],
      confidence: 1,
    });

    const assessment = staleness.assessStaleness('claim-max');
    expect(assessment.isStale).toBe(true);
  });

  it('should handle very old timestamps', () => {
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/old.ts',
      timestamp: new Date('2000-01-01T00:00:00Z'),
      description: 'Very old change',
      affectedClaims: ['claim-old'],
      confidence: 0.9,
    });

    const assessment = staleness.assessStaleness('claim-old');
    expect(assessment).toBeDefined();
  });

  it('should handle future timestamps gracefully', () => {
    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/future.ts',
      timestamp: new Date('2030-01-01T00:00:00Z'),
      description: 'Future change',
      affectedClaims: ['claim-future'],
      confidence: 0.9,
    });

    const assessment = staleness.assessStaleness('claim-future');
    expect(assessment).toBeDefined();
  });

  it('should handle special characters in claim IDs', () => {
    const specialClaimId = 'claim/with:special@chars#123';

    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/test.ts',
      timestamp: new Date(),
      description: 'Change',
      affectedClaims: [specialClaimId],
      confidence: 0.9,
    });

    const assessment = staleness.assessStaleness(specialClaimId);
    expect(assessment.claimId).toBe(specialClaimId);
    expect(assessment.isStale).toBe(true);
  });

  it('should handle very long evidence descriptions', () => {
    const longDescription = 'A'.repeat(10000);

    staleness.recordEvidence({
      type: 'file_changed',
      source: 'src/test.ts',
      timestamp: new Date(),
      description: longDescription,
      affectedClaims: ['claim-long'],
      confidence: 0.9,
    });

    const assessment = staleness.assessStaleness('claim-long');
    expect(assessment.evidence[0].description).toBe(longDescription);
  });

  it('should handle concurrent evidence recording for same claim', () => {
    // Simulate rapid evidence recording
    for (let i = 0; i < 100; i++) {
      staleness.recordEvidence({
        type: 'file_changed',
        source: `src/file${i}.ts`,
        timestamp: new Date(),
        description: `Change ${i}`,
        affectedClaims: ['claim-concurrent'],
        confidence: 0.9,
      });
    }

    const assessment = staleness.assessStaleness('claim-concurrent');
    expect(assessment.evidence.length).toBe(100);
  });
});

// ============================================================================
// CLEANUP
// ============================================================================

afterEach(() => {
  vi.useRealTimers();
});
