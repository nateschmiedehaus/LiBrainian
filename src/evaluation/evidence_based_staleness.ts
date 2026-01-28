/**
 * @fileoverview Evidence-Based Staleness (WU-CALX-006)
 *
 * Replaces arbitrary time-based staleness with evidence-based detection.
 * Knowledge is stale only when there's EVIDENCE of change, not just time passage.
 *
 * Key principle: "No evidence of change = not stale"
 *
 * This module addresses the Time Decay Fallacy - the false assumption that
 * knowledge becomes unreliable simply because time has passed. In reality:
 * - Time alone is NOT sufficient evidence of staleness
 * - Must have actual change signals (file modifications, API changes, etc.)
 * - Frequency-based scheduling uses historical change patterns, not arbitrary decay
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Evidence types that can indicate staleness
 */
export type EvidenceType =
  | 'file_changed'
  | 'api_changed'
  | 'dependency_updated'
  | 'test_failed'
  | 'user_feedback';

/**
 * Evidence of a change that may affect claim validity
 */
export interface StalenessEvidence {
  /** Type of change evidence */
  type: EvidenceType;
  /** Source of the evidence (file path, API endpoint, etc.) */
  source: string;
  /** When the change was detected */
  timestamp: Date;
  /** Human-readable description of what changed */
  description: string;
  /** Claims affected by this change */
  affectedClaims: string[];
  /** Confidence that this change actually affects the claims (0-1) */
  confidence: number;
}

/**
 * Assessment of whether a claim is stale
 */
export interface StalenessAssessment {
  /** ID of the claim being assessed */
  claimId: string;
  /** Whether the claim is stale (only true if evidence exists) */
  isStale: boolean;
  /** Reason for staleness (only set if isStale is true) */
  stalenessReason?: string;
  /** Evidence supporting the staleness assessment */
  evidence: StalenessEvidence[];
  /** When the claim was last validated */
  lastValidated: Date;
  /** Suggested next validation date (based on change frequency, not arbitrary time) */
  nextValidationDue?: Date;
}

/**
 * Profile of how frequently an entity changes
 */
export interface ChangeFrequencyProfile {
  /** ID of the entity (file path, API endpoint, etc.) */
  entityId: string;
  /** Historical changes recorded for this entity */
  historicalChanges: { date: Date; type: string }[];
  /** Average interval between changes in days */
  avgChangeInterval: number;
  /** Volatility classification */
  volatility: 'stable' | 'moderate' | 'volatile';
  /** Suggested interval for checking this entity (in days) */
  suggestedCheckInterval: number;
}

/**
 * Configuration for staleness detection
 */
export interface StalenessConfig {
  /** If true, claims are only stale with evidence (no arbitrary time decay) */
  requireEvidenceForStale: boolean;
  /** Minimum confidence threshold for evidence to trigger staleness */
  minimumEvidenceConfidence: number;
  /** Multipliers applied to base check interval based on volatility */
  volatilityMultipliers: {
    stable: number;
    moderate: number;
    volatile: number;
  };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration that enforces evidence-based staleness
 */
export const DEFAULT_STALENESS_CONFIG: StalenessConfig = {
  requireEvidenceForStale: true,
  minimumEvidenceConfidence: 0.5,
  volatilityMultipliers: {
    stable: 2.0,   // Stable entities get 2x longer intervals
    moderate: 1.0, // Moderate entities use base interval
    volatile: 0.5, // Volatile entities get 0.5x intervals (more frequent checks)
  },
};

// ============================================================================
// CONSTANTS
// ============================================================================

/** Threshold for average change interval to classify as stable (>14 days) */
const STABLE_THRESHOLD_DAYS = 14;

/** Threshold for average change interval to classify as volatile (<3 days) */
const VOLATILE_THRESHOLD_DAYS = 3;

/** Default check interval in days when no history exists */
const DEFAULT_CHECK_INTERVAL_DAYS = 30;

/** Base check interval in days for scheduling */
const BASE_CHECK_INTERVAL_DAYS = 7;

// ============================================================================
// EVIDENCE-BASED STALENESS CLASS
// ============================================================================

/**
 * Evidence-based staleness detection
 *
 * Key principle: "No evidence of change = not stale"
 * Time alone is NOT sufficient evidence of staleness.
 */
export class EvidenceBasedStaleness {
  private config: StalenessConfig;
  private evidenceByClaimId: Map<string, StalenessEvidence[]> = new Map();
  private changeHistoryByEntity: Map<string, { date: Date; type: string }[]> = new Map();
  private claimValidationTimes: Map<string, Date> = new Map();

  constructor(config: StalenessConfig = DEFAULT_STALENESS_CONFIG) {
    this.config = config;
  }

  /**
   * Assess whether a claim is stale
   *
   * KEY PRINCIPLE: A claim is only stale if there is EVIDENCE of change.
   * Time passage alone does NOT make a claim stale.
   *
   * @param claimId - The ID of the claim to assess
   * @returns Assessment including staleness status and evidence
   */
  assessStaleness(claimId: string): StalenessAssessment {
    const now = new Date();
    const evidence = this.getEvidenceForClaim(claimId);

    // Filter evidence by confidence threshold
    const significantEvidence = evidence.filter(
      (e) => e.confidence >= this.config.minimumEvidenceConfidence
    );

    // KEY PRINCIPLE: No evidence = not stale (when requireEvidenceForStale is true)
    if (this.config.requireEvidenceForStale && significantEvidence.length === 0) {
      return {
        claimId,
        isStale: false,
        evidence: [],
        lastValidated: this.getLastValidated(claimId),
        nextValidationDue: this.calculateNextValidation(claimId),
      };
    }

    // With evidence, assess staleness
    const isStale = significantEvidence.length > 0;
    const stalenessReason = isStale
      ? this.buildStalenessReason(significantEvidence)
      : undefined;

    return {
      claimId,
      isStale,
      stalenessReason,
      evidence: significantEvidence,
      lastValidated: this.getLastValidated(claimId),
      nextValidationDue: this.calculateNextValidation(claimId),
    };
  }

  /**
   * Record evidence of a change
   *
   * @param evidence - The evidence to record
   */
  recordEvidence(evidence: StalenessEvidence): void {
    // Record evidence for each affected claim
    for (const claimId of evidence.affectedClaims) {
      const existing = this.evidenceByClaimId.get(claimId) || [];
      existing.push(evidence);
      this.evidenceByClaimId.set(claimId, existing);
    }

    // Update change history for the source entity
    this.recordChangeForEntity(evidence.source, evidence.timestamp, evidence.type);
  }

  /**
   * Get the change frequency profile for an entity
   *
   * @param entityId - The ID of the entity (file path, API endpoint, etc.)
   * @returns Profile including historical changes and volatility classification
   */
  getChangeProfile(entityId: string): ChangeFrequencyProfile {
    const history = this.changeHistoryByEntity.get(entityId) || [];

    // Calculate average change interval
    const avgChangeInterval = this.calculateAverageChangeInterval(history);

    // Classify volatility
    const volatility = this.classifyVolatility(avgChangeInterval, history.length);

    // Calculate suggested check interval
    const suggestedCheckInterval = this.calculateSuggestedCheckInterval(
      avgChangeInterval,
      volatility
    );

    return {
      entityId,
      historicalChanges: history,
      avgChangeInterval,
      volatility,
      suggestedCheckInterval,
    };
  }

  /**
   * Suggest when to next validate an entity
   *
   * The suggestion is based on historical change patterns, NOT arbitrary time decay.
   *
   * @param entityId - The ID of the entity
   * @returns Suggested date for next validation
   */
  suggestValidationSchedule(entityId: string): Date {
    const profile = this.getChangeProfile(entityId);
    const now = new Date();

    // Calculate next validation based on change patterns
    const intervalMs = profile.suggestedCheckInterval * 24 * 60 * 60 * 1000;

    return new Date(now.getTime() + intervalMs);
  }

  /**
   * Check if time-based decay is valid for an entity
   *
   * Time decay is ONLY valid when based on historical change patterns.
   * Arbitrary time decay without evidence is NOT valid.
   *
   * @param entityId - The ID of the entity
   * @returns Validity assessment with reason
   */
  isTimeDecayValid(entityId: string): { valid: boolean; reason: string } {
    const history = this.changeHistoryByEntity.get(entityId) || [];

    if (history.length === 0) {
      return {
        valid: false,
        reason:
          'Time decay without evidence is invalid. ' +
          'Time alone is NOT sufficient evidence of staleness. ' +
          'No historical change patterns exist for this entity.',
      };
    }

    if (history.length < 2) {
      return {
        valid: false,
        reason:
          'Time decay without sufficient evidence is invalid. ' +
          'Only one data point exists - cannot establish a change pattern.',
      };
    }

    return {
      valid: true,
      reason:
        'Time-based validation schedule is valid because it is based on ' +
        `historical change patterns. ${history.length} changes recorded ` +
        'provide evidence for predicting future changes.',
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get all evidence for a specific claim
   */
  private getEvidenceForClaim(claimId: string): StalenessEvidence[] {
    return this.evidenceByClaimId.get(claimId) || [];
  }

  /**
   * Get the last validation time for a claim
   */
  private getLastValidated(claimId: string): Date {
    return this.claimValidationTimes.get(claimId) || new Date();
  }

  /**
   * Record a change for an entity in its history
   */
  private recordChangeForEntity(entityId: string, date: Date, type: string): void {
    const history = this.changeHistoryByEntity.get(entityId) || [];
    history.push({ date, type });

    // Sort by date descending (most recent first)
    history.sort((a, b) => b.date.getTime() - a.date.getTime());

    this.changeHistoryByEntity.set(entityId, history);
  }

  /**
   * Calculate average interval between changes in days
   */
  private calculateAverageChangeInterval(
    history: { date: Date; type: string }[]
  ): number {
    if (history.length < 2) {
      // Not enough data points - return a large interval (stable assumption)
      return DEFAULT_CHECK_INTERVAL_DAYS;
    }

    // Calculate intervals between consecutive changes
    const intervals: number[] = [];
    for (let i = 0; i < history.length - 1; i++) {
      const intervalMs = history[i].date.getTime() - history[i + 1].date.getTime();
      const intervalDays = intervalMs / (24 * 60 * 60 * 1000);
      intervals.push(Math.abs(intervalDays));
    }

    // Calculate average
    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;

    return avgInterval;
  }

  /**
   * Classify volatility based on change frequency
   */
  private classifyVolatility(
    avgIntervalDays: number,
    historyCount: number
  ): 'stable' | 'moderate' | 'volatile' {
    // With insufficient history, default to stable
    if (historyCount < 2) {
      return 'stable';
    }

    if (avgIntervalDays >= STABLE_THRESHOLD_DAYS) {
      return 'stable';
    }

    if (avgIntervalDays <= VOLATILE_THRESHOLD_DAYS) {
      return 'volatile';
    }

    return 'moderate';
  }

  /**
   * Calculate suggested check interval based on volatility
   */
  private calculateSuggestedCheckInterval(
    avgChangeInterval: number,
    volatility: 'stable' | 'moderate' | 'volatile'
  ): number {
    const multiplier = this.config.volatilityMultipliers[volatility];

    // Use average change interval as base, with a minimum floor
    const baseInterval = Math.max(avgChangeInterval, BASE_CHECK_INTERVAL_DAYS);

    return baseInterval * multiplier;
  }

  /**
   * Calculate next validation date for a claim
   */
  private calculateNextValidation(claimId: string): Date {
    const now = new Date();

    // Find the source entity for this claim from evidence
    const evidence = this.getEvidenceForClaim(claimId);
    if (evidence.length > 0) {
      // Use the most recent evidence's source for scheduling
      const source = evidence[0].source;
      return this.suggestValidationSchedule(source);
    }

    // No evidence - use default interval
    const defaultIntervalMs = DEFAULT_CHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() + defaultIntervalMs);
  }

  /**
   * Build a human-readable staleness reason from evidence
   */
  private buildStalenessReason(evidence: StalenessEvidence[]): string {
    const types = [...new Set(evidence.map((e) => e.type))];
    const descriptions = evidence.map((e) => e.description).slice(0, 3);

    const typeString = types.join(', ');
    const descString = descriptions.join('; ');

    return `Stale due to ${typeString}: ${descString}`;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new EvidenceBasedStaleness instance
 *
 * @param config - Optional configuration (defaults to evidence-based staleness)
 * @returns New EvidenceBasedStaleness instance
 */
export function createEvidenceBasedStaleness(
  config: StalenessConfig = DEFAULT_STALENESS_CONFIG
): EvidenceBasedStaleness {
  return new EvidenceBasedStaleness(config);
}
