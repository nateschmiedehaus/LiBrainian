/**
 * @fileoverview Causal Attribution for Outcomes (WU-CALX-001)
 *
 * This module implements causal attribution analysis to determine which claims
 * and decisions caused specific outcomes. It uses counterfactual analysis
 * ("Would outcome differ if claim X were different?") and Shapley value-inspired
 * attribution to fairly distribute credit among contributing claims.
 *
 * Key Features:
 * - Record claims with confidence scores and timestamps
 * - Record outcomes linked to claims
 * - Compute attribution scores using Shapley-inspired fair attribution
 * - Estimate counterfactual deltas (outcome change if claim were different)
 * - Track claim impact across positive/negative outcomes
 * - Identify high-impact claims above a threshold
 *
 * Theoretical Background:
 * ----------------------
 * Attribution in multi-factor scenarios is challenging because:
 * 1. Multiple claims may contribute to a single outcome
 * 2. Claims have different confidence levels
 * 3. Temporal proximity matters (recent claims are more relevant)
 * 4. Fair attribution requires considering marginal contributions
 *
 * We use a Shapley-inspired approach where each claim's attribution is
 * proportional to its marginal contribution weighted by:
 * - Claim confidence (higher confidence = stronger causal link)
 * - Temporal proximity (closer to outcome = more relevant)
 *
 * Counterfactual analysis estimates: "How much would the outcome probability
 * change if this claim were absent or different?"
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A claim made by the system with confidence and provenance information.
 */
export interface Claim {
  /** Unique identifier for this claim */
  id: string;
  /** The content/assertion of the claim */
  content: string;
  /** Confidence score (0-1) in this claim's accuracy */
  confidence: number;
  /** When this claim was made */
  timestamp: Date;
  /** Source/origin of this claim (e.g., "entailment_checker", "ast_extractor") */
  source: string;
}

/**
 * An outcome resulting from processing that may be caused by one or more claims.
 */
export interface Outcome {
  /** Unique identifier for this outcome */
  id: string;
  /** Type of outcome */
  type: 'accept' | 'reject' | 'error' | 'success';
  /** Human-readable description of the outcome */
  description: string;
  /** When this outcome occurred */
  timestamp: Date;
  /** IDs of claims that may have contributed to this outcome */
  relatedClaimIds: string[];
}

/**
 * Attribution result for a single claim-outcome relationship.
 */
export interface AttributionResult {
  /** ID of the claim being attributed */
  claimId: string;
  /** ID of the outcome */
  outcomeId: string;
  /** Attribution score (0-1): how much this claim contributed to the outcome */
  attributionScore: number;
  /** Counterfactual delta (0-1): estimated change if claim were different */
  counterfactualDelta: number;
  /** Confidence in this attribution (0-1) */
  confidence: number;
  /** Human-readable explanation of the attribution */
  explanation: string;
}

/**
 * Complete attribution report for an outcome.
 */
export interface AttributionReport {
  /** ID of the outcome being analyzed */
  outcomeId: string;
  /** All attribution results for this outcome */
  attributions: AttributionResult[];
  /** ID of the dominant (highest attributed) claim, if any stands out */
  dominantClaim?: string;
  /** Uncertainty level of this attribution analysis */
  uncertaintyLevel: 'low' | 'medium' | 'high';
}

/**
 * Impact summary for a single claim across all its outcomes.
 */
export interface ClaimImpact {
  /** Number of positive outcomes (success, accept) this claim contributed to */
  positiveOutcomes: number;
  /** Number of negative outcomes (error, reject) this claim contributed to */
  negativeOutcomes: number;
  /** Average attribution score across all related outcomes */
  avgAttribution: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Types of outcomes considered "positive"
 */
const POSITIVE_OUTCOME_TYPES: Outcome['type'][] = ['success', 'accept'];

/**
 * Types of outcomes considered "negative"
 */
const NEGATIVE_OUTCOME_TYPES: Outcome['type'][] = ['error', 'reject'];

/**
 * Threshold for considering a claim "dominant" (must have this much more
 * attribution than the second-highest claim)
 */
const DOMINANCE_THRESHOLD = 0.3;

/**
 * Decay factor for temporal proximity (claims farther in time are weighted less)
 * This is the half-life in milliseconds (5 minutes)
 */
const TEMPORAL_DECAY_HALF_LIFE_MS = 5 * 60 * 1000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compute temporal proximity weight based on time difference.
 * Uses exponential decay with configurable half-life.
 *
 * @param claimTimestamp - When the claim was made
 * @param outcomeTimestamp - When the outcome occurred
 * @returns Weight between 0 and 1 (1 = simultaneous, approaches 0 as time increases)
 */
function computeTemporalWeight(
  claimTimestamp: Date,
  outcomeTimestamp: Date
): number {
  const timeDiffMs = Math.abs(
    outcomeTimestamp.getTime() - claimTimestamp.getTime()
  );
  // Exponential decay: weight = 2^(-timeDiff / halfLife)
  return Math.pow(2, -timeDiffMs / TEMPORAL_DECAY_HALF_LIFE_MS);
}

/**
 * Compute combined weight for a claim based on confidence and temporal proximity.
 *
 * @param claim - The claim to weight
 * @param outcomeTimestamp - When the outcome occurred
 * @returns Combined weight (product of confidence and temporal weight)
 */
function computeClaimWeight(claim: Claim, outcomeTimestamp: Date): number {
  const temporalWeight = computeTemporalWeight(claim.timestamp, outcomeTimestamp);
  return claim.confidence * temporalWeight;
}

/**
 * Determine uncertainty level based on attribution characteristics.
 *
 * @param attributions - The computed attributions
 * @param claims - The claims involved
 * @returns Uncertainty level
 */
function determineUncertaintyLevel(
  attributions: AttributionResult[],
  claims: Claim[]
): 'low' | 'medium' | 'high' {
  if (attributions.length === 0) {
    return 'high';
  }

  // Calculate average confidence
  const avgConfidence =
    claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length;

  // Calculate entropy of attribution distribution
  const entropy = attributions.reduce((sum, a) => {
    if (a.attributionScore > 0) {
      return sum - a.attributionScore * Math.log2(a.attributionScore);
    }
    return sum;
  }, 0);
  const maxEntropy = Math.log2(attributions.length || 1);
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  // High confidence + low entropy = low uncertainty
  if (avgConfidence > 0.8 && normalizedEntropy < 0.3) {
    return 'low';
  }
  // Low confidence or high entropy = high uncertainty
  if (avgConfidence < 0.5 || normalizedEntropy > 0.8) {
    return 'high';
  }
  return 'medium';
}

/**
 * Generate explanation for an attribution result.
 *
 * @param claim - The claim
 * @param attributionScore - The computed attribution score
 * @param temporalWeight - The temporal weight used
 * @param isPositive - Whether the outcome is positive
 * @returns Human-readable explanation
 */
function generateExplanation(
  claim: Claim,
  attributionScore: number,
  temporalWeight: number,
  isPositive: boolean
): string {
  const contributionLevel =
    attributionScore > 0.6
      ? 'Primary'
      : attributionScore > 0.3
        ? 'Significant'
        : 'Minor';

  const confidenceLevel =
    claim.confidence > 0.8
      ? 'high'
      : claim.confidence > 0.5
        ? 'moderate'
        : 'low';

  const recencyNote =
    temporalWeight > 0.8
      ? 'recent'
      : temporalWeight > 0.5
        ? 'moderately recent'
        : 'older';

  const outcomeType = isPositive ? 'positive' : 'negative';

  return `${contributionLevel} contributor to ${outcomeType} outcome. ` +
    `Claim has ${confidenceLevel} confidence (${(claim.confidence * 100).toFixed(0)}%) ` +
    `and is ${recencyNote} relative to the outcome.`;
}

// ============================================================================
// CAUSAL ATTRIBUTOR CLASS
// ============================================================================

/**
 * CausalAttributor tracks claims and outcomes to determine which claims
 * caused which outcomes using attribution analysis.
 *
 * @example
 * ```typescript
 * const attributor = createCausalAttributor();
 *
 * // Record claims as they're made
 * attributor.recordClaim({
 *   id: 'claim-1',
 *   content: 'Function X returns string',
 *   confidence: 0.9,
 *   timestamp: new Date(),
 *   source: 'ast_extractor'
 * });
 *
 * // Record outcomes as they occur
 * attributor.recordOutcome({
 *   id: 'outcome-1',
 *   type: 'success',
 *   description: 'Query answered successfully',
 *   timestamp: new Date(),
 *   relatedClaimIds: ['claim-1']
 * });
 *
 * // Compute attribution
 * const report = attributor.computeAttribution('outcome-1');
 * console.log(report.attributions[0].attributionScore);
 * ```
 */
export class CausalAttributor {
  private claims: Claim[] = [];
  private outcomes: Outcome[] = [];
  private claimsById: Map<string, Claim[]> = new Map();

  /**
   * Record a claim for attribution tracking.
   * Claims with the same ID are tracked separately (for evolving claims).
   *
   * @param claim - The claim to record
   */
  recordClaim(claim: Claim): void {
    this.claims.push(claim);

    // Index by ID for quick lookup
    const existing = this.claimsById.get(claim.id) || [];
    existing.push(claim);
    this.claimsById.set(claim.id, existing);
  }

  /**
   * Record an outcome for attribution tracking.
   *
   * @param outcome - The outcome to record
   */
  recordOutcome(outcome: Outcome): void {
    this.outcomes.push(outcome);
  }

  /**
   * Get all recorded claims.
   *
   * @returns Array of all claims
   */
  getClaims(): Claim[] {
    return [...this.claims];
  }

  /**
   * Get all recorded outcomes.
   *
   * @returns Array of all outcomes
   */
  getOutcomes(): Outcome[] {
    return [...this.outcomes];
  }

  /**
   * Clear all recorded claims and outcomes.
   */
  clear(): void {
    this.claims = [];
    this.outcomes = [];
    this.claimsById.clear();
  }

  /**
   * Compute attribution for a specific outcome.
   *
   * Uses Shapley-inspired attribution where each claim's contribution is
   * weighted by its confidence and temporal proximity to the outcome.
   * Attributions sum to 1.0 (efficiency property).
   *
   * @param outcomeId - ID of the outcome to analyze
   * @returns Attribution report with scores and explanations
   */
  computeAttribution(outcomeId: string): AttributionReport {
    const outcome = this.outcomes.find((o) => o.id === outcomeId);

    if (!outcome) {
      return {
        outcomeId,
        attributions: [],
        uncertaintyLevel: 'high',
      };
    }

    // Get the most recent version of each related claim
    const relatedClaims: Claim[] = [];
    for (const claimId of outcome.relatedClaimIds) {
      const claimVersions = this.claimsById.get(claimId);
      if (claimVersions && claimVersions.length > 0) {
        // Use the most recent version
        const mostRecent = claimVersions.reduce((latest, current) =>
          current.timestamp > latest.timestamp ? current : latest
        );
        relatedClaims.push(mostRecent);
      }
    }

    if (relatedClaims.length === 0) {
      return {
        outcomeId,
        attributions: [],
        uncertaintyLevel: 'high',
      };
    }

    // Compute weights for each claim
    const weights = relatedClaims.map((claim) =>
      computeClaimWeight(claim, outcome.timestamp)
    );
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    // Normalize to get attribution scores (sum to 1.0)
    const attributions: AttributionResult[] = relatedClaims.map(
      (claim, idx) => {
        const attributionScore =
          totalWeight > 0 ? weights[idx] / totalWeight : 1 / relatedClaims.length;

        const temporalWeight = computeTemporalWeight(
          claim.timestamp,
          outcome.timestamp
        );

        // Counterfactual delta: how much would outcome change without this claim?
        // Higher for sole contributors, higher confidence, and more recent claims
        const counterfactualDelta =
          (attributionScore * claim.confidence * (1 + temporalWeight)) / 2;

        const isPositive = POSITIVE_OUTCOME_TYPES.includes(outcome.type);

        return {
          claimId: claim.id,
          outcomeId,
          attributionScore,
          counterfactualDelta: Math.min(counterfactualDelta, 1),
          confidence: claim.confidence,
          explanation: generateExplanation(
            claim,
            attributionScore,
            temporalWeight,
            isPositive
          ),
        };
      }
    );

    // Identify dominant claim if one stands out
    const sortedByScore = [...attributions].sort(
      (a, b) => b.attributionScore - a.attributionScore
    );
    let dominantClaim: string | undefined;
    if (sortedByScore.length >= 2) {
      const topScore = sortedByScore[0].attributionScore;
      const secondScore = sortedByScore[1].attributionScore;
      if (topScore - secondScore >= DOMINANCE_THRESHOLD) {
        dominantClaim = sortedByScore[0].claimId;
      }
    } else if (sortedByScore.length === 1) {
      dominantClaim = sortedByScore[0].claimId;
    }

    const uncertaintyLevel = determineUncertaintyLevel(
      attributions,
      relatedClaims
    );

    return {
      outcomeId,
      attributions,
      dominantClaim,
      uncertaintyLevel,
    };
  }

  /**
   * Get the impact of a specific claim across all related outcomes.
   *
   * @param claimId - ID of the claim to analyze
   * @returns Impact summary with outcome counts and average attribution
   */
  getClaimImpact(claimId: string): ClaimImpact {
    // Find all outcomes that reference this claim
    const relatedOutcomes = this.outcomes.filter((o) =>
      o.relatedClaimIds.includes(claimId)
    );

    if (relatedOutcomes.length === 0) {
      return {
        positiveOutcomes: 0,
        negativeOutcomes: 0,
        avgAttribution: 0,
      };
    }

    let positiveOutcomes = 0;
    let negativeOutcomes = 0;
    let totalAttribution = 0;

    for (const outcome of relatedOutcomes) {
      // Count positive/negative outcomes
      if (POSITIVE_OUTCOME_TYPES.includes(outcome.type)) {
        positiveOutcomes++;
      } else if (NEGATIVE_OUTCOME_TYPES.includes(outcome.type)) {
        negativeOutcomes++;
      }

      // Compute attribution for this outcome
      const report = this.computeAttribution(outcome.id);
      const attribution = report.attributions.find(
        (a) => a.claimId === claimId
      );
      if (attribution) {
        totalAttribution += attribution.attributionScore;
      }
    }

    return {
      positiveOutcomes,
      negativeOutcomes,
      avgAttribution: totalAttribution / relatedOutcomes.length,
    };
  }

  /**
   * Find all claims with average attribution above a threshold.
   *
   * @param threshold - Minimum average attribution score (0-1)
   * @returns Array of high-impact claims
   */
  findHighImpactClaims(threshold: number): Claim[] {
    const highImpactClaims: Claim[] = [];
    const processedIds = new Set<string>();

    for (const claim of this.claims) {
      // Skip if we've already processed this claim ID
      if (processedIds.has(claim.id)) {
        continue;
      }
      processedIds.add(claim.id);

      // Check if this claim has any related outcomes
      const relatedOutcomes = this.outcomes.filter((o) =>
        o.relatedClaimIds.includes(claim.id)
      );

      if (relatedOutcomes.length === 0) {
        continue;
      }

      // Compute average attribution
      const impact = this.getClaimImpact(claim.id);

      if (impact.avgAttribution >= threshold) {
        // Get the most recent version of this claim
        const claimVersions = this.claimsById.get(claim.id);
        if (claimVersions && claimVersions.length > 0) {
          const mostRecent = claimVersions.reduce((latest, current) =>
            current.timestamp > latest.timestamp ? current : latest
          );
          highImpactClaims.push(mostRecent);
        }
      }
    }

    return highImpactClaims;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CausalAttributor instance.
 *
 * @returns A fresh CausalAttributor instance
 */
export function createCausalAttributor(): CausalAttributor {
  return new CausalAttributor();
}
