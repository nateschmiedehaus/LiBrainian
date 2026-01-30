/**
 * @fileoverview Temporal Grounding Validity System
 *
 * Implements time-indexed grounding for the epistemic framework, enabling
 * representation of dynamic epistemic states without full temporal logic.
 *
 * Based on Recommendation 7.2 from adversarial synthesis:
 * - Time-indexed grounding enables representation of dynamic epistemic states
 * - Captures 80% of temporal use cases with minimal complexity
 * - Not full temporal logic (no temporal operators), but sufficient for practical needs
 *
 * @packageDocumentation
 */

import type { Grounding, ObjectId, GroundingId, GradedStrength } from './universal_coherence.js';
import { createGroundingId } from './universal_coherence.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for temporal grounding types */
export const TEMPORAL_GROUNDING_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// TEMPORAL BOUNDS INTERFACE
// ============================================================================

/**
 * Decay function type for grounding strength over time.
 *
 * - 'none': No decay, strength remains constant within validity period
 * - 'linear': Strength decreases linearly from 1.0 to 0.0 over validity period
 * - 'exponential': Strength decays exponentially based on halfLife
 * - 'step': Strength remains full until validUntil, then drops to 0
 */
export type DecayFunction = 'none' | 'linear' | 'exponential' | 'step';

/**
 * Temporal bounds for grounding validity.
 *
 * Defines when a grounding relation is valid and how its strength
 * changes over time.
 */
export interface TemporalBounds {
  /**
   * Start of validity period.
   * null means the grounding has always been valid (infinite past)
   */
  readonly validFrom: Date | null;

  /**
   * End of validity period.
   * null means the grounding never expires (infinite future)
   */
  readonly validUntil: Date | null;

  /**
   * How grounding strength decays over time.
   */
  readonly decayFunction: DecayFunction;

  /**
   * Half-life in milliseconds for exponential decay.
   * Only applicable when decayFunction is 'exponential'.
   */
  readonly halfLife?: number;
}

// ============================================================================
// TEMPORAL GROUNDING INTERFACE
// ============================================================================

/**
 * A grounding relation with temporal validity constraints.
 *
 * Extends the base Grounding interface with temporal metadata to support
 * time-indexed epistemic queries and automatic staleness detection.
 */
export interface TemporalGrounding extends Grounding {
  /**
   * Temporal bounds defining when this grounding is valid
   * and how its strength decays over time.
   */
  readonly temporal: TemporalBounds;

  /**
   * When this grounding relation was created.
   */
  readonly createdAt: Date;

  /**
   * When this grounding was last verified to be accurate.
   * Used for staleness detection.
   */
  readonly lastVerified: Date;
}

// ============================================================================
// TEMPORAL BOUNDS PRESETS
// ============================================================================

/**
 * Preset for ephemeral information (valid for 1 hour).
 *
 * Use for: real-time data, live status updates, temporary observations
 * Step decay: full strength until expiration, then invalid
 */
export const EPHEMERAL: TemporalBounds = {
  validFrom: null,
  validUntil: null, // Will be set to createdAt + 1 hour when applied
  decayFunction: 'step',
};

/**
 * Helper to create ephemeral bounds from a creation time.
 */
export function createEphemeralBounds(createdAt: Date = new Date()): TemporalBounds {
  return {
    validFrom: null,
    validUntil: new Date(createdAt.getTime() + 60 * 60 * 1000), // 1 hour
    decayFunction: 'step',
  };
}

/**
 * Preset for short-term information (valid for 24 hours).
 *
 * Use for: daily reports, recent test results, fresh observations
 * Linear decay: strength decreases uniformly over the validity period
 */
export const SHORT_TERM: TemporalBounds = {
  validFrom: null,
  validUntil: null, // Will be set to createdAt + 24 hours when applied
  decayFunction: 'linear',
};

/**
 * Helper to create short-term bounds from a creation time.
 */
export function createShortTermBounds(createdAt: Date = new Date()): TemporalBounds {
  return {
    validFrom: null,
    validUntil: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000), // 24 hours
    decayFunction: 'linear',
  };
}

/**
 * Preset for medium-term information (valid for 7 days).
 *
 * Use for: weekly data, sprint-level information, recent analyses
 * Exponential decay with 3-day half-life
 */
export const MEDIUM_TERM: TemporalBounds = {
  validFrom: null,
  validUntil: null, // Will be set to createdAt + 7 days when applied
  decayFunction: 'exponential',
  halfLife: 3 * 24 * 60 * 60 * 1000, // 3 days in milliseconds
};

/**
 * Helper to create medium-term bounds from a creation time.
 */
export function createMediumTermBounds(createdAt: Date = new Date()): TemporalBounds {
  return {
    validFrom: null,
    validUntil: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
    decayFunction: 'exponential',
    halfLife: 3 * 24 * 60 * 60 * 1000, // 3 days
  };
}

/**
 * Preset for long-term information (valid for 30 days).
 *
 * Use for: monthly reports, stable architectural decisions, established patterns
 * Exponential decay with 14-day half-life
 */
export const LONG_TERM: TemporalBounds = {
  validFrom: null,
  validUntil: null, // Will be set to createdAt + 30 days when applied
  decayFunction: 'exponential',
  halfLife: 14 * 24 * 60 * 60 * 1000, // 14 days in milliseconds
};

/**
 * Helper to create long-term bounds from a creation time.
 */
export function createLongTermBounds(createdAt: Date = new Date()): TemporalBounds {
  return {
    validFrom: null,
    validUntil: new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
    decayFunction: 'exponential',
    halfLife: 14 * 24 * 60 * 60 * 1000, // 14 days
  };
}

/**
 * Preset for permanent information (never expires).
 *
 * Use for: axioms, mathematical truths, fundamental principles
 * No decay: strength remains constant forever
 */
export const PERMANENT: TemporalBounds = {
  validFrom: null,
  validUntil: null,
  decayFunction: 'none',
};

/**
 * All temporal bounds presets for convenience.
 */
export const TEMPORAL_PRESETS = {
  ephemeral: EPHEMERAL,
  shortTerm: SHORT_TERM,
  mediumTerm: MEDIUM_TERM,
  longTerm: LONG_TERM,
  permanent: PERMANENT,
} as const;

export type TemporalPresetKey = keyof typeof TEMPORAL_PRESETS;

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if a grounding is valid at a specific time.
 *
 * A grounding is valid if the evaluation time falls within its validity bounds.
 * Null bounds are treated as infinite (past or future).
 *
 * @param grounding - The temporal grounding to check
 * @param atTime - The time to evaluate (defaults to now)
 * @returns true if the grounding is valid at the specified time
 */
export function isGroundingValid(
  grounding: TemporalGrounding,
  atTime: Date = new Date()
): boolean {
  const { validFrom, validUntil } = grounding.temporal;

  // Check lower bound (null = always valid from past)
  if (validFrom !== null && atTime < validFrom) {
    return false;
  }

  // Check upper bound (null = never expires)
  if (validUntil !== null && atTime > validUntil) {
    return false;
  }

  return true;
}

/**
 * Apply decay to a strength value based on elapsed time and temporal bounds.
 *
 * @param strength - The original strength value in [0, 1]
 * @param elapsed - Time elapsed in milliseconds since grounding creation
 * @param bounds - The temporal bounds defining decay behavior
 * @returns The decayed strength value in [0, 1]
 */
export function applyDecay(
  strength: number,
  elapsed: number,
  bounds: TemporalBounds
): number {
  // Validate input
  if (strength < 0 || strength > 1) {
    throw new Error(`Strength must be in [0, 1], got ${strength}`);
  }

  if (elapsed < 0) {
    // Before creation, return full strength (or could be 0 depending on use case)
    return strength;
  }

  switch (bounds.decayFunction) {
    case 'none':
      // No decay - strength remains constant
      return strength;

    case 'step': {
      // Step decay - full strength until validUntil, then 0
      // If validUntil is null, treat as permanent (no decay)
      if (bounds.validUntil === null) {
        return strength;
      }
      // Calculate validity duration from validFrom (or 0 if null)
      const validFromMs = bounds.validFrom?.getTime() ?? 0;
      const validUntilMs = bounds.validUntil.getTime();
      const validityDuration = validUntilMs - validFromMs;
      return elapsed < validityDuration ? strength : 0;
    }

    case 'linear': {
      // Linear decay - strength decreases uniformly to 0
      if (bounds.validUntil === null) {
        // No end bound means no decay target - treat as no decay
        return strength;
      }
      // Calculate validity duration from validFrom (or 0 if null)
      const validFromMs = bounds.validFrom?.getTime() ?? 0;
      const validUntilMs = bounds.validUntil.getTime();
      const validityDuration = validUntilMs - validFromMs;
      if (validityDuration <= 0) {
        return 0;
      }
      const decayFactor = Math.max(0, 1 - elapsed / validityDuration);
      return strength * decayFactor;
    }

    case 'exponential': {
      // Exponential decay based on half-life
      const halfLife = bounds.halfLife;
      if (halfLife === undefined || halfLife <= 0) {
        throw new Error('Exponential decay requires a positive halfLife');
      }
      // decay = e^(-ln(2) * t / halfLife) = 0.5^(t / halfLife)
      const decayFactor = Math.pow(0.5, elapsed / halfLife);
      return strength * decayFactor;
    }

    default:
      // Unknown decay function - treat as no decay
      return strength;
  }
}

/**
 * Get the effective strength of a grounding at a specific time.
 *
 * This combines validity checking with decay application to return
 * the actual effective strength of the grounding relation.
 *
 * @param grounding - The temporal grounding to evaluate
 * @param atTime - The time to evaluate (defaults to now)
 * @returns The effective strength in [0, 1], or 0 if invalid
 */
export function getGroundingStrength(
  grounding: TemporalGrounding,
  atTime: Date = new Date()
): number {
  // First check validity
  if (!isGroundingValid(grounding, atTime)) {
    return 0;
  }

  // Calculate elapsed time from creation
  const elapsed = atTime.getTime() - grounding.createdAt.getTime();

  // Apply decay to the base strength
  return applyDecay(grounding.strength.value, elapsed, grounding.temporal);
}

/**
 * Detect stale groundings that have decayed below a threshold.
 *
 * A grounding is considered stale if its effective strength
 * has fallen below the specified threshold.
 *
 * @param groundings - Array of temporal groundings to check
 * @param threshold - Minimum acceptable strength (0-1)
 * @param atTime - Time to evaluate (defaults to now)
 * @returns Array of groundings that are stale
 */
export function detectStaleGroundings(
  groundings: TemporalGrounding[],
  threshold: number,
  atTime: Date = new Date()
): TemporalGrounding[] {
  if (threshold < 0 || threshold > 1) {
    throw new Error(`Threshold must be in [0, 1], got ${threshold}`);
  }

  return groundings.filter((grounding) => {
    const strength = getGroundingStrength(grounding, atTime);
    return strength < threshold;
  });
}

/**
 * Refresh a grounding by updating its lastVerified timestamp.
 *
 * This creates a new TemporalGrounding with the same properties
 * but an updated lastVerified timestamp, effectively resetting
 * the staleness clock.
 *
 * @param grounding - The grounding to refresh
 * @param newVerificationTime - The new verification time (defaults to now)
 * @returns A new TemporalGrounding with updated lastVerified
 */
export function refreshGrounding(
  grounding: TemporalGrounding,
  newVerificationTime: Date = new Date()
): TemporalGrounding {
  return {
    ...grounding,
    lastVerified: newVerificationTime,
  };
}

// ============================================================================
// CONSTRUCTION HELPERS
// ============================================================================

/**
 * Options for constructing a temporal grounding.
 */
export interface TemporalGroundingOptions {
  /** Preset to use for temporal bounds */
  preset?: TemporalPresetKey;

  /** Custom temporal bounds (overrides preset) */
  temporal?: TemporalBounds;

  /** Custom creation time (defaults to now) */
  createdAt?: Date;

  /** Custom last verified time (defaults to createdAt) */
  lastVerified?: Date;

  /** Whether the grounding is active */
  active?: boolean;

  /** Explanation for the grounding */
  explanation?: string;
}

/**
 * Construct a temporal grounding from basic grounding parameters.
 *
 * @param from - Source object ID (the grounding object)
 * @param to - Target object ID (the grounded object)
 * @param type - Type of grounding relation
 * @param strength - Strength of the grounding
 * @param options - Temporal grounding options
 * @returns A new TemporalGrounding
 */
export function constructTemporalGrounding(
  from: ObjectId,
  to: ObjectId,
  type: Grounding['type'],
  strength: GradedStrength,
  options: TemporalGroundingOptions = {}
): TemporalGrounding {
  // Validate reflexivity
  if (from === to) {
    throw new Error('Object cannot ground itself');
  }

  const createdAt = options.createdAt ?? new Date();
  const lastVerified = options.lastVerified ?? createdAt;

  // Determine temporal bounds
  let temporal: TemporalBounds;
  if (options.temporal) {
    temporal = options.temporal;
  } else if (options.preset) {
    // Use preset with proper initialization
    switch (options.preset) {
      case 'ephemeral':
        temporal = createEphemeralBounds(createdAt);
        break;
      case 'shortTerm':
        temporal = createShortTermBounds(createdAt);
        break;
      case 'mediumTerm':
        temporal = createMediumTermBounds(createdAt);
        break;
      case 'longTerm':
        temporal = createLongTermBounds(createdAt);
        break;
      case 'permanent':
        temporal = PERMANENT;
        break;
      default:
        temporal = PERMANENT;
    }
  } else {
    // Default to permanent
    temporal = PERMANENT;
  }

  return {
    id: createGroundingId('temporal'),
    from,
    to,
    type,
    strength,
    active: options.active ?? true,
    explanation: options.explanation,
    temporal,
    createdAt,
    lastVerified,
  };
}

/**
 * Convert a base Grounding to a TemporalGrounding.
 *
 * @param grounding - The base grounding to convert
 * @param options - Temporal options to apply
 * @returns A new TemporalGrounding with temporal properties
 */
export function toTemporalGrounding(
  grounding: Grounding,
  options: TemporalGroundingOptions = {}
): TemporalGrounding {
  const createdAt = options.createdAt ?? new Date();
  const lastVerified = options.lastVerified ?? createdAt;

  // Determine temporal bounds
  let temporal: TemporalBounds;
  if (options.temporal) {
    temporal = options.temporal;
  } else if (options.preset) {
    switch (options.preset) {
      case 'ephemeral':
        temporal = createEphemeralBounds(createdAt);
        break;
      case 'shortTerm':
        temporal = createShortTermBounds(createdAt);
        break;
      case 'mediumTerm':
        temporal = createMediumTermBounds(createdAt);
        break;
      case 'longTerm':
        temporal = createLongTermBounds(createdAt);
        break;
      case 'permanent':
        temporal = PERMANENT;
        break;
      default:
        temporal = PERMANENT;
    }
  } else {
    temporal = PERMANENT;
  }

  return {
    ...grounding,
    temporal,
    createdAt,
    lastVerified,
  };
}

/**
 * Check if a value is a TemporalGrounding.
 */
export function isTemporalGrounding(value: unknown): value is TemporalGrounding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === 'string' &&
    typeof obj.from === 'string' &&
    typeof obj.to === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.strength === 'object' &&
    obj.strength !== null &&
    typeof obj.temporal === 'object' &&
    obj.temporal !== null &&
    obj.createdAt instanceof Date &&
    obj.lastVerified instanceof Date
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate the age of a grounding since its creation.
 *
 * @param grounding - The temporal grounding
 * @param atTime - Reference time (defaults to now)
 * @returns Age in milliseconds
 */
export function getGroundingAge(
  grounding: TemporalGrounding,
  atTime: Date = new Date()
): number {
  return atTime.getTime() - grounding.createdAt.getTime();
}

/**
 * Calculate the time since last verification.
 *
 * @param grounding - The temporal grounding
 * @param atTime - Reference time (defaults to now)
 * @returns Time since last verification in milliseconds
 */
export function getTimeSinceVerification(
  grounding: TemporalGrounding,
  atTime: Date = new Date()
): number {
  return atTime.getTime() - grounding.lastVerified.getTime();
}

/**
 * Calculate the remaining validity time for a grounding.
 *
 * @param grounding - The temporal grounding
 * @param atTime - Reference time (defaults to now)
 * @returns Remaining time in milliseconds, or Infinity if no expiration
 */
export function getRemainingValidity(
  grounding: TemporalGrounding,
  atTime: Date = new Date()
): number {
  if (grounding.temporal.validUntil === null) {
    return Infinity;
  }

  const remaining = grounding.temporal.validUntil.getTime() - atTime.getTime();
  return Math.max(0, remaining);
}

/**
 * Extend the validity period of a grounding.
 *
 * @param grounding - The grounding to extend
 * @param extension - Extension time in milliseconds
 * @returns A new TemporalGrounding with extended validity
 */
export function extendValidity(
  grounding: TemporalGrounding,
  extension: number
): TemporalGrounding {
  if (grounding.temporal.validUntil === null) {
    // Already permanent, no change needed
    return grounding;
  }

  const newValidUntil = new Date(
    grounding.temporal.validUntil.getTime() + extension
  );

  return {
    ...grounding,
    temporal: {
      ...grounding.temporal,
      validUntil: newValidUntil,
    },
  };
}

/**
 * Get groundings that will expire within a time window.
 *
 * Useful for proactive refresh scheduling.
 *
 * @param groundings - Array of temporal groundings
 * @param windowMs - Time window in milliseconds
 * @param atTime - Reference time (defaults to now)
 * @returns Groundings expiring within the window
 */
export function getExpiringGroundings(
  groundings: TemporalGrounding[],
  windowMs: number,
  atTime: Date = new Date()
): TemporalGrounding[] {
  const windowEnd = atTime.getTime() + windowMs;

  return groundings.filter((grounding) => {
    if (grounding.temporal.validUntil === null) {
      return false; // Never expires
    }

    const expiresAt = grounding.temporal.validUntil.getTime();
    return expiresAt > atTime.getTime() && expiresAt <= windowEnd;
  });
}

/**
 * Group groundings by their decay function type.
 *
 * @param groundings - Array of temporal groundings
 * @returns Map from decay function to groundings
 */
export function groupByDecayFunction(
  groundings: TemporalGrounding[]
): Map<DecayFunction, TemporalGrounding[]> {
  const groups = new Map<DecayFunction, TemporalGrounding[]>();

  for (const grounding of groundings) {
    const decay = grounding.temporal.decayFunction;
    const existing = groups.get(decay) ?? [];
    existing.push(grounding);
    groups.set(decay, existing);
  }

  return groups;
}

/**
 * Sort groundings by remaining validity (most urgent first).
 *
 * @param groundings - Array of temporal groundings
 * @param atTime - Reference time (defaults to now)
 * @returns Sorted array (shortest remaining validity first)
 */
export function sortByUrgency(
  groundings: TemporalGrounding[],
  atTime: Date = new Date()
): TemporalGrounding[] {
  return [...groundings].sort((a, b) => {
    const remainingA = getRemainingValidity(a, atTime);
    const remainingB = getRemainingValidity(b, atTime);
    return remainingA - remainingB;
  });
}
