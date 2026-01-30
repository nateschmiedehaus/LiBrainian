/**
 * @fileoverview Tests for Temporal Grounding Validity System
 *
 * Tests the time-indexed grounding functionality including:
 * - Temporal bounds and validity checking
 * - Decay functions (none, linear, exponential, step)
 * - Staleness detection
 * - Grounding refresh
 * - Presets (ephemeral, short-term, medium-term, long-term, permanent)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  type TemporalBounds,
  type TemporalGrounding,
  type DecayFunction,
  type TemporalPresetKey,
  // Constants and presets
  TEMPORAL_GROUNDING_SCHEMA_VERSION,
  EPHEMERAL,
  SHORT_TERM,
  MEDIUM_TERM,
  LONG_TERM,
  PERMANENT,
  TEMPORAL_PRESETS,
  // Preset helpers
  createEphemeralBounds,
  createShortTermBounds,
  createMediumTermBounds,
  createLongTermBounds,
  // Core functions
  isGroundingValid,
  getGroundingStrength,
  detectStaleGroundings,
  refreshGrounding,
  applyDecay,
  // Construction
  constructTemporalGrounding,
  toTemporalGrounding,
  isTemporalGrounding,
  // Utilities
  getGroundingAge,
  getTimeSinceVerification,
  getRemainingValidity,
  extendValidity,
  getExpiringGroundings,
  groupByDecayFunction,
  sortByUrgency,
} from '../temporal_grounding.js';
import {
  createObjectId,
  constructGrounding,
  type ObjectId,
  type GradedStrength,
} from '../universal_coherence.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/** Create a basic temporal grounding for testing */
function createTestGrounding(
  options: {
    temporal?: TemporalBounds;
    createdAt?: Date;
    lastVerified?: Date;
    strength?: number;
  } = {}
): TemporalGrounding {
  const fromId = createObjectId('from');
  const toId = createObjectId('to');
  const createdAt = options.createdAt ?? new Date();
  const lastVerified = options.lastVerified ?? createdAt;

  return constructTemporalGrounding(
    fromId,
    toId,
    'evidential',
    { value: options.strength ?? 1.0, basis: 'measured' },
    {
      temporal: options.temporal ?? PERMANENT,
      createdAt,
      lastVerified,
    }
  );
}

// ============================================================================
// 1. SCHEMA VERSION TESTS
// ============================================================================

describe('Schema Version', () => {
  it('should have a defined schema version', () => {
    expect(TEMPORAL_GROUNDING_SCHEMA_VERSION).toBe('1.0.0');
  });
});

// ============================================================================
// 2. TEMPORAL BOUNDS TESTS
// ============================================================================

describe('Temporal Bounds', () => {
  describe('PERMANENT preset', () => {
    it('should have no temporal bounds', () => {
      expect(PERMANENT.validFrom).toBeNull();
      expect(PERMANENT.validUntil).toBeNull();
      expect(PERMANENT.decayFunction).toBe('none');
    });
  });

  describe('EPHEMERAL preset', () => {
    it('should use step decay', () => {
      expect(EPHEMERAL.decayFunction).toBe('step');
    });

    it('should create bounds with 1 hour validity', () => {
      const now = new Date();
      const bounds = createEphemeralBounds(now);
      expect(bounds.validUntil).not.toBeNull();
      expect(bounds.validUntil!.getTime() - now.getTime()).toBe(60 * 60 * 1000);
    });
  });

  describe('SHORT_TERM preset', () => {
    it('should use linear decay', () => {
      expect(SHORT_TERM.decayFunction).toBe('linear');
    });

    it('should create bounds with 24 hour validity', () => {
      const now = new Date();
      const bounds = createShortTermBounds(now);
      expect(bounds.validUntil).not.toBeNull();
      expect(bounds.validUntil!.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('MEDIUM_TERM preset', () => {
    it('should use exponential decay with 3-day half-life', () => {
      expect(MEDIUM_TERM.decayFunction).toBe('exponential');
      expect(MEDIUM_TERM.halfLife).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('should create bounds with 7 day validity', () => {
      const now = new Date();
      const bounds = createMediumTermBounds(now);
      expect(bounds.validUntil).not.toBeNull();
      expect(bounds.validUntil!.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('LONG_TERM preset', () => {
    it('should use exponential decay with 14-day half-life', () => {
      expect(LONG_TERM.decayFunction).toBe('exponential');
      expect(LONG_TERM.halfLife).toBe(14 * 24 * 60 * 60 * 1000);
    });

    it('should create bounds with 30 day validity', () => {
      const now = new Date();
      const bounds = createLongTermBounds(now);
      expect(bounds.validUntil).not.toBeNull();
      expect(bounds.validUntil!.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });
});

// ============================================================================
// 3. VALIDITY CHECKING TESTS
// ============================================================================

describe('isGroundingValid', () => {
  it('should return true for permanent grounding', () => {
    const grounding = createTestGrounding({ temporal: PERMANENT });
    expect(isGroundingValid(grounding)).toBe(true);
  });

  it('should return true when within validity period', () => {
    const now = new Date();
    const grounding = createTestGrounding({
      temporal: {
        validFrom: new Date(now.getTime() - 1000),
        validUntil: new Date(now.getTime() + 1000),
        decayFunction: 'none',
      },
    });
    expect(isGroundingValid(grounding, now)).toBe(true);
  });

  it('should return false before validFrom', () => {
    const now = new Date();
    const grounding = createTestGrounding({
      temporal: {
        validFrom: new Date(now.getTime() + 1000), // Future
        validUntil: null,
        decayFunction: 'none',
      },
    });
    expect(isGroundingValid(grounding, now)).toBe(false);
  });

  it('should return false after validUntil', () => {
    const now = new Date();
    const grounding = createTestGrounding({
      createdAt: new Date(now.getTime() - 10000),
      temporal: {
        validFrom: null,
        validUntil: new Date(now.getTime() - 1000), // Past
        decayFunction: 'none',
      },
    });
    expect(isGroundingValid(grounding, now)).toBe(false);
  });

  it('should handle null validFrom correctly (always valid from past)', () => {
    const ancientTime = new Date('1900-01-01');
    const grounding = createTestGrounding({
      temporal: {
        validFrom: null,
        validUntil: new Date('2100-01-01'),
        decayFunction: 'none',
      },
    });
    expect(isGroundingValid(grounding, ancientTime)).toBe(true);
  });

  it('should handle null validUntil correctly (never expires)', () => {
    const futureTime = new Date('2100-01-01');
    const grounding = createTestGrounding({
      temporal: {
        validFrom: new Date('2020-01-01'),
        validUntil: null,
        decayFunction: 'none',
      },
    });
    expect(isGroundingValid(grounding, futureTime)).toBe(true);
  });
});

// ============================================================================
// 4. DECAY FUNCTION TESTS
// ============================================================================

describe('applyDecay', () => {
  describe('no decay', () => {
    it('should return original strength', () => {
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'none',
      };
      expect(applyDecay(0.8, 1000000, bounds)).toBe(0.8);
    });
  });

  describe('step decay', () => {
    it('should return full strength before validUntil', () => {
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: new Date(Date.now() + 10000),
        decayFunction: 'step',
      };
      expect(applyDecay(0.9, 5000, bounds)).toBe(0.9);
    });

    it('should return 0 after validUntil', () => {
      const now = Date.now();
      const bounds: TemporalBounds = {
        validFrom: new Date(now),
        validUntil: new Date(now + 10000),
        decayFunction: 'step',
      };
      expect(applyDecay(0.9, 15000, bounds)).toBe(0);
    });

    it('should treat null validUntil as no decay', () => {
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'step',
      };
      expect(applyDecay(0.8, 1000000, bounds)).toBe(0.8);
    });
  });

  describe('linear decay', () => {
    it('should decay linearly over validity period', () => {
      const now = Date.now();
      const bounds: TemporalBounds = {
        validFrom: new Date(now),
        validUntil: new Date(now + 10000),
        decayFunction: 'linear',
      };

      // At 50% of validity period, strength should be 50%
      expect(applyDecay(1.0, 5000, bounds)).toBeCloseTo(0.5, 5);

      // At 25% of validity period, strength should be 75%
      expect(applyDecay(1.0, 2500, bounds)).toBeCloseTo(0.75, 5);

      // At 100% of validity period, strength should be 0
      expect(applyDecay(1.0, 10000, bounds)).toBeCloseTo(0, 5);
    });

    it('should not go below 0', () => {
      const now = Date.now();
      const bounds: TemporalBounds = {
        validFrom: new Date(now),
        validUntil: new Date(now + 10000),
        decayFunction: 'linear',
      };
      expect(applyDecay(1.0, 20000, bounds)).toBe(0);
    });

    it('should treat null validUntil as no decay', () => {
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'linear',
      };
      expect(applyDecay(0.8, 1000000, bounds)).toBe(0.8);
    });
  });

  describe('exponential decay', () => {
    it('should decay to half at one half-life', () => {
      const halfLife = 10000; // 10 seconds
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'exponential',
        halfLife,
      };

      expect(applyDecay(1.0, halfLife, bounds)).toBeCloseTo(0.5, 5);
    });

    it('should decay to quarter at two half-lives', () => {
      const halfLife = 10000;
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'exponential',
        halfLife,
      };

      expect(applyDecay(1.0, halfLife * 2, bounds)).toBeCloseTo(0.25, 5);
    });

    it('should throw if halfLife is undefined', () => {
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'exponential',
      };

      expect(() => applyDecay(1.0, 1000, bounds)).toThrow('positive halfLife');
    });

    it('should throw if halfLife is 0', () => {
      const bounds: TemporalBounds = {
        validFrom: null,
        validUntil: null,
        decayFunction: 'exponential',
        halfLife: 0,
      };

      expect(() => applyDecay(1.0, 1000, bounds)).toThrow('positive halfLife');
    });
  });

  describe('input validation', () => {
    it('should throw if strength is negative', () => {
      expect(() => applyDecay(-0.1, 1000, PERMANENT)).toThrow('must be in [0, 1]');
    });

    it('should throw if strength is greater than 1', () => {
      expect(() => applyDecay(1.1, 1000, PERMANENT)).toThrow('must be in [0, 1]');
    });

    it('should return full strength for negative elapsed time', () => {
      expect(applyDecay(0.8, -1000, PERMANENT)).toBe(0.8);
    });
  });
});

// ============================================================================
// 5. GROUNDING STRENGTH TESTS
// ============================================================================

describe('getGroundingStrength', () => {
  it('should return 0 for invalid grounding', () => {
    const now = new Date();
    const grounding = createTestGrounding({
      createdAt: new Date(now.getTime() - 10000),
      temporal: {
        validFrom: null,
        validUntil: new Date(now.getTime() - 5000), // Expired
        decayFunction: 'none',
      },
    });
    expect(getGroundingStrength(grounding, now)).toBe(0);
  });

  it('should return full strength for permanent grounding', () => {
    const grounding = createTestGrounding({
      temporal: PERMANENT,
      strength: 0.9,
    });
    expect(getGroundingStrength(grounding)).toBe(0.9);
  });

  it('should apply decay based on elapsed time', () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 5000);
    const halfLife = 10000;

    const grounding = createTestGrounding({
      createdAt,
      temporal: {
        validFrom: null,
        validUntil: null,
        decayFunction: 'exponential',
        halfLife,
      },
      strength: 1.0,
    });

    // 5000ms elapsed, halfLife is 10000ms
    // Expected: 1.0 * 0.5^(5000/10000) = 1.0 * 0.5^0.5 = ~0.707
    expect(getGroundingStrength(grounding, now)).toBeCloseTo(0.707, 2);
  });
});

// ============================================================================
// 6. STALENESS DETECTION TESTS
// ============================================================================

describe('detectStaleGroundings', () => {
  it('should detect groundings below threshold', () => {
    const now = new Date();
    const halfLife = 10000;

    // Create grounding that's 2 half-lives old (strength ~0.25)
    const oldGrounding = createTestGrounding({
      createdAt: new Date(now.getTime() - halfLife * 2),
      temporal: {
        validFrom: null,
        validUntil: null,
        decayFunction: 'exponential',
        halfLife,
      },
      strength: 1.0,
    });

    // Create fresh grounding (strength ~1.0)
    const freshGrounding = createTestGrounding({
      createdAt: now,
      temporal: PERMANENT,
      strength: 1.0,
    });

    const stale = detectStaleGroundings([oldGrounding, freshGrounding], 0.5, now);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toBe(oldGrounding);
  });

  it('should return empty array when no groundings are stale', () => {
    const grounding = createTestGrounding({
      temporal: PERMANENT,
      strength: 0.8,
    });

    const stale = detectStaleGroundings([grounding], 0.5);
    expect(stale).toHaveLength(0);
  });

  it('should throw if threshold is invalid', () => {
    expect(() => detectStaleGroundings([], -0.1)).toThrow('must be in [0, 1]');
    expect(() => detectStaleGroundings([], 1.1)).toThrow('must be in [0, 1]');
  });
});

// ============================================================================
// 7. REFRESH GROUNDING TESTS
// ============================================================================

describe('refreshGrounding', () => {
  it('should update lastVerified timestamp', () => {
    const originalTime = new Date('2024-01-01');
    const newTime = new Date('2024-06-01');

    const grounding = createTestGrounding({
      createdAt: originalTime,
      lastVerified: originalTime,
    });

    const refreshed = refreshGrounding(grounding, newTime);

    expect(refreshed.lastVerified).toEqual(newTime);
    expect(refreshed.createdAt).toEqual(originalTime); // Should not change
  });

  it('should preserve all other properties', () => {
    const grounding = createTestGrounding({
      temporal: MEDIUM_TERM,
      strength: 0.85,
    });

    const refreshed = refreshGrounding(grounding);

    expect(refreshed.id).toBe(grounding.id);
    expect(refreshed.from).toBe(grounding.from);
    expect(refreshed.to).toBe(grounding.to);
    expect(refreshed.type).toBe(grounding.type);
    expect(refreshed.strength).toEqual(grounding.strength);
    expect(refreshed.temporal).toEqual(grounding.temporal);
  });

  it('should default to now if no time provided', () => {
    const grounding = createTestGrounding();
    const before = new Date();
    const refreshed = refreshGrounding(grounding);
    const after = new Date();

    expect(refreshed.lastVerified.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(refreshed.lastVerified.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// 8. CONSTRUCTION TESTS
// ============================================================================

describe('constructTemporalGrounding', () => {
  it('should create a valid temporal grounding', () => {
    const fromId = createObjectId('from');
    const toId = createObjectId('to');

    const grounding = constructTemporalGrounding(
      fromId,
      toId,
      'inferential',
      { value: 0.9, basis: 'measured' },
      { preset: 'shortTerm' }
    );

    expect(grounding.from).toBe(fromId);
    expect(grounding.to).toBe(toId);
    expect(grounding.type).toBe('inferential');
    expect(grounding.strength.value).toBe(0.9);
    expect(grounding.temporal.decayFunction).toBe('linear');
    expect(grounding.createdAt).toBeInstanceOf(Date);
    expect(grounding.lastVerified).toBeInstanceOf(Date);
  });

  it('should throw on reflexive grounding', () => {
    const id = createObjectId('self');
    expect(() =>
      constructTemporalGrounding(id, id, 'evidential', { value: 1.0, basis: 'measured' })
    ).toThrow('cannot ground itself');
  });

  it('should use preset correctly', () => {
    const fromId = createObjectId('from');
    const toId = createObjectId('to');

    const ephemeral = constructTemporalGrounding(
      fromId,
      toId,
      'evidential',
      { value: 1.0, basis: 'measured' },
      { preset: 'ephemeral' }
    );
    expect(ephemeral.temporal.decayFunction).toBe('step');

    const permanent = constructTemporalGrounding(
      fromId,
      toId,
      'evidential',
      { value: 1.0, basis: 'measured' },
      { preset: 'permanent' }
    );
    expect(permanent.temporal.decayFunction).toBe('none');
    expect(permanent.temporal.validUntil).toBeNull();
  });

  it('should allow custom temporal bounds to override preset', () => {
    const fromId = createObjectId('from');
    const toId = createObjectId('to');
    const customBounds: TemporalBounds = {
      validFrom: new Date('2024-01-01'),
      validUntil: new Date('2024-12-31'),
      decayFunction: 'linear',
    };

    const grounding = constructTemporalGrounding(
      fromId,
      toId,
      'evidential',
      { value: 1.0, basis: 'measured' },
      { temporal: customBounds, preset: 'permanent' } // temporal should override
    );

    expect(grounding.temporal).toEqual(customBounds);
  });
});

describe('toTemporalGrounding', () => {
  it('should convert a base Grounding to TemporalGrounding', () => {
    const fromId = createObjectId('from');
    const toId = createObjectId('to');

    const baseGrounding = constructGrounding(fromId, toId, 'evidential');
    const temporal = toTemporalGrounding(baseGrounding, { preset: 'mediumTerm' });

    expect(temporal.id).toBe(baseGrounding.id);
    expect(temporal.from).toBe(baseGrounding.from);
    expect(temporal.to).toBe(baseGrounding.to);
    expect(temporal.temporal.decayFunction).toBe('exponential');
    expect(temporal.temporal.halfLife).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

describe('isTemporalGrounding', () => {
  it('should return true for valid temporal grounding', () => {
    const grounding = createTestGrounding();
    expect(isTemporalGrounding(grounding)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isTemporalGrounding(null)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isTemporalGrounding('string')).toBe(false);
    expect(isTemporalGrounding(123)).toBe(false);
  });

  it('should return false for object missing temporal properties', () => {
    const fromId = createObjectId('from');
    const toId = createObjectId('to');
    const baseGrounding = constructGrounding(fromId, toId, 'evidential');
    expect(isTemporalGrounding(baseGrounding)).toBe(false);
  });
});

// ============================================================================
// 9. UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  describe('getGroundingAge', () => {
    it('should calculate age correctly', () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 5000);
      const grounding = createTestGrounding({ createdAt });

      expect(getGroundingAge(grounding, now)).toBe(5000);
    });
  });

  describe('getTimeSinceVerification', () => {
    it('should calculate time since verification correctly', () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 10000);
      const lastVerified = new Date(now.getTime() - 3000);
      const grounding = createTestGrounding({ createdAt, lastVerified });

      expect(getTimeSinceVerification(grounding, now)).toBe(3000);
    });
  });

  describe('getRemainingValidity', () => {
    it('should return Infinity for permanent grounding', () => {
      const grounding = createTestGrounding({ temporal: PERMANENT });
      expect(getRemainingValidity(grounding)).toBe(Infinity);
    });

    it('should return remaining time for bounded grounding', () => {
      const now = new Date();
      const grounding = createTestGrounding({
        temporal: {
          validFrom: null,
          validUntil: new Date(now.getTime() + 5000),
          decayFunction: 'none',
        },
      });

      expect(getRemainingValidity(grounding, now)).toBe(5000);
    });

    it('should return 0 for expired grounding', () => {
      const now = new Date();
      const grounding = createTestGrounding({
        createdAt: new Date(now.getTime() - 10000),
        temporal: {
          validFrom: null,
          validUntil: new Date(now.getTime() - 5000),
          decayFunction: 'none',
        },
      });

      expect(getRemainingValidity(grounding, now)).toBe(0);
    });
  });

  describe('extendValidity', () => {
    it('should extend validUntil by specified amount', () => {
      const now = new Date();
      const originalEnd = new Date(now.getTime() + 5000);
      const grounding = createTestGrounding({
        temporal: {
          validFrom: null,
          validUntil: originalEnd,
          decayFunction: 'none',
        },
      });

      const extended = extendValidity(grounding, 10000);
      expect(extended.temporal.validUntil!.getTime()).toBe(originalEnd.getTime() + 10000);
    });

    it('should return unchanged grounding for permanent', () => {
      const grounding = createTestGrounding({ temporal: PERMANENT });
      const extended = extendValidity(grounding, 10000);
      expect(extended.temporal.validUntil).toBeNull();
    });
  });

  describe('getExpiringGroundings', () => {
    it('should find groundings expiring within window', () => {
      const now = new Date();

      const expiring = createTestGrounding({
        temporal: {
          validFrom: null,
          validUntil: new Date(now.getTime() + 3000),
          decayFunction: 'none',
        },
      });

      const notExpiring = createTestGrounding({
        temporal: {
          validFrom: null,
          validUntil: new Date(now.getTime() + 10000),
          decayFunction: 'none',
        },
      });

      const permanent = createTestGrounding({ temporal: PERMANENT });

      const result = getExpiringGroundings([expiring, notExpiring, permanent], 5000, now);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(expiring);
    });
  });

  describe('groupByDecayFunction', () => {
    it('should group groundings by decay function', () => {
      const none = createTestGrounding({ temporal: PERMANENT });
      const linear = createTestGrounding({ temporal: createShortTermBounds() });
      const exponential = createTestGrounding({ temporal: createMediumTermBounds() });
      const step = createTestGrounding({ temporal: createEphemeralBounds() });

      const groups = groupByDecayFunction([none, linear, exponential, step]);

      expect(groups.get('none')).toHaveLength(1);
      expect(groups.get('linear')).toHaveLength(1);
      expect(groups.get('exponential')).toHaveLength(1);
      expect(groups.get('step')).toHaveLength(1);
    });
  });

  describe('sortByUrgency', () => {
    it('should sort groundings by remaining validity', () => {
      const now = new Date();

      const urgent = createTestGrounding({
        temporal: {
          validFrom: null,
          validUntil: new Date(now.getTime() + 1000),
          decayFunction: 'none',
        },
      });

      const lessUrgent = createTestGrounding({
        temporal: {
          validFrom: null,
          validUntil: new Date(now.getTime() + 5000),
          decayFunction: 'none',
        },
      });

      const permanent = createTestGrounding({ temporal: PERMANENT });

      const sorted = sortByUrgency([lessUrgent, permanent, urgent], now);

      expect(sorted[0]).toBe(urgent);
      expect(sorted[1]).toBe(lessUrgent);
      expect(sorted[2]).toBe(permanent);
    });
  });
});

// ============================================================================
// 10. INTEGRATION TESTS
// ============================================================================

describe('Integration Tests', () => {
  it('should work with complete lifecycle: create, decay, detect stale, refresh', () => {
    const now = new Date();
    const halfLife = 10000;

    // Create grounding
    const fromId = createObjectId('evidence');
    const toId = createObjectId('claim');

    const grounding = constructTemporalGrounding(
      fromId,
      toId,
      'evidential',
      { value: 1.0, basis: 'measured' },
      {
        temporal: {
          validFrom: null,
          validUntil: null,
          decayFunction: 'exponential',
          halfLife,
        },
        createdAt: now,
      }
    );

    // Check initial strength
    expect(getGroundingStrength(grounding, now)).toBeCloseTo(1.0, 5);

    // Check strength after one half-life
    const later = new Date(now.getTime() + halfLife);
    expect(getGroundingStrength(grounding, later)).toBeCloseTo(0.5, 2);

    // Detect staleness at threshold 0.6 (after one half-life, strength is ~0.5)
    const stale = detectStaleGroundings([grounding], 0.6, later);
    expect(stale).toHaveLength(1);

    // Refresh the grounding
    const refreshed = refreshGrounding(grounding, later);
    expect(refreshed.lastVerified).toEqual(later);
    expect(refreshed.createdAt).toEqual(now); // Creation time unchanged
  });

  it('should support mixed preset usage', () => {
    const groundings: TemporalGrounding[] = [];
    const fromId = createObjectId('source');
    const toId = createObjectId('target');

    // Create groundings with different presets
    const presetKeys: TemporalPresetKey[] = ['ephemeral', 'shortTerm', 'mediumTerm', 'longTerm', 'permanent'];

    for (const preset of presetKeys) {
      groundings.push(
        constructTemporalGrounding(
          createObjectId('from'),
          createObjectId('to'),
          'evidential',
          { value: 1.0, basis: 'measured' },
          { preset }
        )
      );
    }

    // Group by decay function
    const groups = groupByDecayFunction(groundings);

    expect(groups.get('step')).toHaveLength(1); // ephemeral
    expect(groups.get('linear')).toHaveLength(1); // shortTerm
    expect(groups.get('exponential')).toHaveLength(2); // mediumTerm, longTerm
    expect(groups.get('none')).toHaveLength(1); // permanent
  });
});
