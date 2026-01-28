/**
 * @fileoverview Unified Claim-Outcome Index (WU-CALX-002)
 *
 * Provides a unified index for tracking relationships between claims and their
 * outcomes, enabling calibration analysis queries. This index supports:
 * - Efficient indexing and retrieval of claims and outcomes
 * - Relationship tracking between claims and outcomes
 * - Temporal relationship queries
 * - Calibration data generation for confidence analysis
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A claim that has been indexed for tracking
 */
export interface IndexedClaim {
  /** Unique identifier for the claim */
  id: string;
  /** The content/text of the claim */
  content: string;
  /** Confidence level (0.0 to 1.0) */
  confidence: number;
  /** Type of claim (e.g., 'structural', 'behavioral') */
  claimType: string;
  /** When the claim was created */
  createdAt: Date;
  /** Source of the claim (e.g., 'librarian', 'user') */
  source: string;
  /** Tags for categorization */
  tags: string[];
}

/**
 * An outcome associated with a claim
 */
export interface IndexedOutcome {
  /** Unique identifier for the outcome */
  id: string;
  /** Type of outcome */
  outcomeType: 'accept' | 'reject' | 'error' | 'timeout' | 'partial';
  /** When the outcome occurred */
  timestamp: Date;
  /** Additional metadata about the outcome */
  metadata: Record<string, unknown>;
}

/**
 * A relationship between a claim and an outcome
 */
export interface ClaimOutcomeRelation {
  /** ID of the related claim */
  claimId: string;
  /** ID of the related outcome */
  outcomeId: string;
  /** Type of relationship */
  relationshipType: 'caused' | 'contributed' | 'correlated';
  /** Weight/strength of the relationship (typically 0.0 to 1.0, but can exceed) */
  weight: number;
  /** When the relation was established */
  createdAt: Date;
}

/**
 * Query parameters for calibration data
 */
export interface CalibrationQuery {
  /** Filter by confidence range [min, max] */
  confidenceRange?: [number, number];
  /** Filter by claim types */
  claimTypes?: string[];
  /** Filter by time range [start, end] */
  timeRange?: [Date, Date];
  /** Filter by outcome types (note: typo preserved from spec) */
  outcomTypes?: string[];
}

/**
 * A single data point in a calibration curve
 */
export interface CalibrationDataPoint {
  /** Lower bound of the confidence bin */
  binStart: number;
  /** Upper bound of the confidence bin */
  binEnd: number;
  /** Predicted probability (bin midpoint) */
  predictedProbability: number;
  /** Actual observed frequency of correct outcomes */
  actualFrequency: number;
  /** Number of samples in this bin */
  sampleCount: number;
  /** IDs of claims in this bin */
  claims: string[];
}

// ============================================================================
// CLAIM OUTCOME INDEX CLASS
// ============================================================================

/**
 * Unified index for tracking claim-outcome relationships and calibration analysis
 */
export class ClaimOutcomeIndex {
  /** Map of claim ID to claim */
  private claims: Map<string, IndexedClaim>;

  /** Map of outcome ID to outcome */
  private outcomes: Map<string, IndexedOutcome>;

  /** Map of claim ID to its relations */
  private claimRelations: Map<string, ClaimOutcomeRelation[]>;

  /** Map of outcome ID to its relations */
  private outcomeRelations: Map<string, ClaimOutcomeRelation[]>;

  /** Default number of bins for calibration curves */
  private static readonly DEFAULT_BIN_COUNT = 10;

  constructor() {
    this.claims = new Map();
    this.outcomes = new Map();
    this.claimRelations = new Map();
    this.outcomeRelations = new Map();
  }

  // ==========================================================================
  // INDEXING METHODS
  // ==========================================================================

  /**
   * Index a claim for tracking
   * @param claim - The claim to index
   */
  indexClaim(claim: IndexedClaim): void {
    this.claims.set(claim.id, { ...claim });
  }

  /**
   * Index an outcome for tracking
   * @param outcome - The outcome to index
   */
  indexOutcome(outcome: IndexedOutcome): void {
    this.outcomes.set(outcome.id, { ...outcome });
  }

  /**
   * Add a relationship between a claim and an outcome
   * @param relation - The relation to add
   */
  addRelation(relation: ClaimOutcomeRelation): void {
    const relationCopy = { ...relation };

    // Add to claim relations
    const claimRels = this.claimRelations.get(relation.claimId) || [];
    claimRels.push(relationCopy);
    this.claimRelations.set(relation.claimId, claimRels);

    // Add to outcome relations
    const outcomeRels = this.outcomeRelations.get(relation.outcomeId) || [];
    outcomeRels.push(relationCopy);
    this.outcomeRelations.set(relation.outcomeId, outcomeRels);
  }

  // ==========================================================================
  // RETRIEVAL METHODS
  // ==========================================================================

  /**
   * Get a claim by ID
   * @param claimId - The claim ID
   * @returns The claim or undefined
   */
  getClaim(claimId: string): IndexedClaim | undefined {
    return this.claims.get(claimId);
  }

  /**
   * Get an outcome by ID
   * @param outcomeId - The outcome ID
   * @returns The outcome or undefined
   */
  getOutcome(outcomeId: string): IndexedOutcome | undefined {
    return this.outcomes.get(outcomeId);
  }

  /**
   * Get all relations for a claim
   * @param claimId - The claim ID
   * @returns Array of relations
   */
  getRelationsForClaim(claimId: string): ClaimOutcomeRelation[] {
    return this.claimRelations.get(claimId) || [];
  }

  /**
   * Get all relations for an outcome
   * @param outcomeId - The outcome ID
   * @returns Array of relations
   */
  getRelationsForOutcome(outcomeId: string): ClaimOutcomeRelation[] {
    return this.outcomeRelations.get(outcomeId) || [];
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Query claims by confidence range
   * @param range - [min, max] confidence values (inclusive)
   * @returns Array of matching claims
   */
  queryByConfidence(range: [number, number]): IndexedClaim[] {
    const [min, max] = range;

    // Handle inverted range
    if (min > max) {
      return [];
    }

    const results: IndexedClaim[] = [];
    const claimsArray = Array.from(this.claims.values());
    for (const claim of claimsArray) {
      if (claim.confidence >= min && claim.confidence <= max) {
        results.push(claim);
      }
    }
    return results;
  }

  /**
   * Query claims related to a specific outcome
   * @param outcomeId - The outcome ID
   * @returns Array of claims related to this outcome
   */
  queryByOutcome(outcomeId: string): IndexedClaim[] {
    const relations = this.outcomeRelations.get(outcomeId) || [];
    const uniqueClaimIds = new Set<string>();
    const results: IndexedClaim[] = [];

    for (const relation of relations) {
      if (uniqueClaimIds.has(relation.claimId)) {
        continue;
      }
      uniqueClaimIds.add(relation.claimId);

      const claim = this.claims.get(relation.claimId);
      if (claim) {
        results.push(claim);
      }
    }

    return results;
  }

  /**
   * Query claims by time range
   * @param start - Start date
   * @param end - End date
   * @returns Array of claims created within the range
   */
  queryByTimeRange(start: Date, end: Date): IndexedClaim[] {
    const results: IndexedClaim[] = [];
    const claimsArray = Array.from(this.claims.values());
    for (const claim of claimsArray) {
      const createdAt = claim.createdAt.getTime();
      if (createdAt >= start.getTime() && createdAt <= end.getTime()) {
        results.push(claim);
      }
    }
    return results;
  }

  // ==========================================================================
  // CALIBRATION METHODS
  // ==========================================================================

  /**
   * Get calibration data for analysis
   * @param query - Query parameters for filtering
   * @returns Array of calibration data points
   */
  getCalibrationData(query: CalibrationQuery): CalibrationDataPoint[] {
    // Get claims matching the query
    const filteredClaims = this.filterClaimsForCalibration(query);

    // Get claims that have at least one outcome relation
    const claimsWithOutcomes = filteredClaims.filter((claim) => {
      const relations = this.claimRelations.get(claim.id) || [];
      return relations.some((r) => {
        const outcome = this.outcomes.get(r.outcomeId);
        if (!outcome) return false;

        // Filter by outcome types if specified
        if (query.outcomTypes && query.outcomTypes.length > 0) {
          return query.outcomTypes.includes(outcome.outcomeType);
        }
        return true;
      });
    });

    if (claimsWithOutcomes.length === 0) {
      return [];
    }

    // Determine confidence range for binning
    const [minConf, maxConf] = query.confidenceRange || [0.0, 1.0];
    const binCount = ClaimOutcomeIndex.DEFAULT_BIN_COUNT;
    const binSize = (maxConf - minConf) / binCount;

    // Create bins
    const bins: Map<number, { claims: IndexedClaim[]; accepted: number; total: number }> = new Map();

    for (let i = 0; i < binCount; i++) {
      bins.set(i, { claims: [], accepted: 0, total: 0 });
    }

    // Assign claims to bins and calculate outcomes
    for (const claim of claimsWithOutcomes) {
      const binIndex = Math.min(
        Math.floor((claim.confidence - minConf) / binSize),
        binCount - 1
      );

      if (binIndex < 0) continue;

      const bin = bins.get(binIndex);
      if (!bin) continue;

      bin.claims.push(claim);

      // Calculate outcome for this claim
      const outcome = this.calculateClaimOutcome(claim.id, query.outcomTypes);
      if (outcome.total > 0) {
        bin.accepted += outcome.correct;
        bin.total += outcome.total;
      }
    }

    // Generate data points
    const dataPoints: CalibrationDataPoint[] = [];

    for (let i = 0; i < binCount; i++) {
      const bin = bins.get(i);
      if (!bin || bin.claims.length === 0) continue;

      const binStart = minConf + i * binSize;
      const binEnd = minConf + (i + 1) * binSize;
      const predictedProbability = (binStart + binEnd) / 2;
      const actualFrequency = bin.total > 0 ? bin.accepted / bin.total : 0;

      dataPoints.push({
        binStart,
        binEnd,
        predictedProbability,
        actualFrequency,
        sampleCount: bin.claims.length,
        claims: bin.claims.map((c) => c.id),
      });
    }

    return dataPoints;
  }

  /**
   * Get accuracy metrics for a specific claim
   * @param claimId - The claim ID
   * @returns Accuracy metrics
   */
  getClaimAccuracy(claimId: string): { correct: number; total: number; accuracy: number } {
    const relations = this.claimRelations.get(claimId) || [];

    let correct = 0;
    let total = 0;

    for (const relation of relations) {
      const outcome = this.outcomes.get(relation.outcomeId);
      if (!outcome) continue;

      // Skip error and timeout outcomes
      if (outcome.outcomeType === 'error' || outcome.outcomeType === 'timeout') {
        continue;
      }

      total++;

      if (outcome.outcomeType === 'accept') {
        correct++;
      } else if (outcome.outcomeType === 'partial') {
        correct += 0.5;
      }
      // 'reject' contributes 0 to correct
    }

    const accuracy = total > 0 ? correct / total : 0;

    return { correct, total, accuracy };
  }

  // ==========================================================================
  // STATISTICS METHODS
  // ==========================================================================

  /**
   * Get total number of indexed claims
   */
  getClaimCount(): number {
    return this.claims.size;
  }

  /**
   * Get total number of indexed outcomes
   */
  getOutcomeCount(): number {
    return this.outcomes.size;
  }

  /**
   * Get total number of relations
   */
  getRelationCount(): number {
    let count = 0;
    const relationsArray = Array.from(this.claimRelations.values());
    for (const relations of relationsArray) {
      count += relations.length;
    }
    return count;
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Filter claims based on calibration query
   */
  private filterClaimsForCalibration(query: CalibrationQuery): IndexedClaim[] {
    let claims = Array.from(this.claims.values());

    // Filter by confidence range
    if (query.confidenceRange) {
      const [min, max] = query.confidenceRange;
      claims = claims.filter((c) => c.confidence >= min && c.confidence <= max);
    }

    // Filter by claim types
    if (query.claimTypes && query.claimTypes.length > 0) {
      claims = claims.filter((c) => query.claimTypes!.includes(c.claimType));
    }

    // Filter by time range
    if (query.timeRange) {
      const [start, end] = query.timeRange;
      claims = claims.filter((c) => {
        const createdAt = c.createdAt.getTime();
        return createdAt >= start.getTime() && createdAt <= end.getTime();
      });
    }

    return claims;
  }

  /**
   * Calculate outcome metrics for a claim
   */
  private calculateClaimOutcome(
    claimId: string,
    outcomeTypes?: string[]
  ): { correct: number; total: number } {
    const relations = this.claimRelations.get(claimId) || [];

    let correct = 0;
    let total = 0;

    for (const relation of relations) {
      const outcome = this.outcomes.get(relation.outcomeId);
      if (!outcome) continue;

      // Filter by outcome types if specified
      if (outcomeTypes && outcomeTypes.length > 0) {
        if (!outcomeTypes.includes(outcome.outcomeType)) {
          continue;
        }
      }

      // Skip error and timeout outcomes in accuracy calculation
      if (outcome.outcomeType === 'error' || outcome.outcomeType === 'timeout') {
        continue;
      }

      total++;

      if (outcome.outcomeType === 'accept') {
        correct++;
      } else if (outcome.outcomeType === 'partial') {
        correct += 0.5;
      }
    }

    return { correct, total };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ClaimOutcomeIndex instance
 */
export function createClaimOutcomeIndex(): ClaimOutcomeIndex {
  return new ClaimOutcomeIndex();
}
