/**
 * @fileoverview Shared Types for Self-Improvement Primitives
 *
 * Common types used across all self-improvement primitives.
 */

import type { LibrarianStorage } from '../../storage/types.js';

// ============================================================================
// PRIMITIVE METADATA
// ============================================================================

/**
 * Categories of self-improvement primitives.
 */
export type PrimitiveCategory =
  | 'self_indexing'
  | 'self_analysis'
  | 'self_verification'
  | 'self_improvement'
  | 'self_learning';

/**
 * Identifiers for self-improvement primitives.
 */
export type PrimitiveId =
  | 'tp_self_bootstrap'
  | 'tp_self_refresh'
  | 'tp_analyze_architecture'
  | 'tp_analyze_consistency'
  | 'tp_verify_claim'
  | 'tp_verify_calibration'
  | 'tp_improve_generate_recommendations'
  | 'tp_improve_plan_fix'
  | 'tp_improve_create_tests'
  | 'tp_learn_from_outcomes'
  | 'tp_learn_extract_patterns';

/**
 * Metadata about a primitive.
 */
export interface PrimitiveMetadata {
  id: PrimitiveId;
  name: string;
  category: PrimitiveCategory;
  description: string;
  preconditions: string[];
  postconditions: string[];
  estimatedCost: {
    tokens: number;
    time: string;
  };
}

// ============================================================================
// COMMON EXECUTION TYPES
// ============================================================================

/**
 * Base options for all primitives.
 */
export interface BasePrimitiveOptions {
  /** Root directory for the operation */
  rootDir: string;
  /** Storage instance */
  storage: LibrarianStorage;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Base result for all primitives.
 */
export interface BasePrimitiveResult {
  /** Duration of the operation in milliseconds */
  duration: number;
  /** Errors encountered during execution */
  errors: string[];
}

// ============================================================================
// CONFIDENCE AND CALIBRATION TYPES
// ============================================================================

/**
 * Confidence value type following CONFIDENCE_REDESIGN.md.
 */
export interface ConfidenceValue {
  /** Raw confidence score (0.0 - 1.0) */
  score: number;
  /** Confidence tier */
  tier: 'high' | 'medium' | 'low' | 'uncertain';
  /** How the confidence was computed */
  source: 'measured' | 'estimated' | 'default';
  /** Sample size if measured */
  sampleSize?: number;
}

/**
 * Calibration status from verification.
 */
export type CalibrationStatus =
  | 'well_calibrated'
  | 'miscalibrated'
  | 'insufficient_data'
  | 'distribution_shift';

// ============================================================================
// EVIDENCE TYPES
// ============================================================================

/**
 * Types of evidence that can support claims.
 */
export type EvidenceType =
  | 'code'
  | 'test'
  | 'trace'
  | 'assertion'
  | 'measurement';

/**
 * Evidence supporting a claim.
 */
export interface Evidence {
  type: EvidenceType;
  content: string;
  location: string;
  confidence: ConfidenceValue;
}

// ============================================================================
// CLAIM TYPES
// ============================================================================

/**
 * Types of claims about the codebase.
 */
export type ClaimType =
  | 'behavioral'
  | 'structural'
  | 'performance'
  | 'correctness';

/**
 * A claim about the codebase that can be verified.
 */
export interface Claim {
  id: string;
  text: string;
  type: ClaimType;
  source: string;
  context: string;
}

/**
 * Epistemic status of a claim after verification.
 */
export type EpistemicStatus =
  | 'verified_with_evidence'
  | 'refuted_with_evidence'
  | 'inconclusive'
  | 'unverifiable'
  | 'gettier_case';

// ============================================================================
// GETTIER ANALYSIS TYPES
// ============================================================================

/**
 * Analysis of Gettier conditions for a claim.
 * Detects "accidentally true" beliefs.
 */
export interface GettierAnalysis {
  /** Whether this is a potential Gettier case */
  isGettierCase: boolean;
  /** Risk of being a Gettier case (0.0-1.0) */
  gettierRisk: number;
  /** Strength of the justification */
  justificationStrength: number;
  /** Basis for the truth of the claim */
  truthBasis: 'causal' | 'coincidental' | 'unknown';
  /** How to mitigate Gettier risk */
  mitigationPath?: string;
}

// ============================================================================
// RECOMMENDATION TYPES
// ============================================================================

/**
 * Categories of improvement recommendations.
 */
export type RecommendationCategory =
  | 'architecture'
  | 'correctness'
  | 'performance'
  | 'maintainability'
  | 'theoretical';

/**
 * Severity levels for recommendations.
 */
export type RecommendationSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Effort estimate for implementing a recommendation.
 */
export interface EffortEstimate {
  loc: { min: number; max: number };
  hours: { min: number; max: number };
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';
  confidence: ConfidenceValue;
}

/**
 * An improvement recommendation.
 */
export interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: RecommendationCategory;
  priority: number;
  severity: RecommendationSeverity;
  effort: EffortEstimate;
  impact: string;
  affectedFiles: string[];
  relatedIssues: string[];
}

// ============================================================================
// BUDGET TYPES
// ============================================================================

/**
 * Budget constraints for operations.
 */
export interface OperationBudget {
  /** Maximum tokens to use */
  maxTokens: number;
  /** Maximum time in milliseconds */
  maxTimeMs: number;
  /** Maximum API calls */
  maxApiCalls?: number;
}

/**
 * Default budget for self-improvement operations.
 */
export const DEFAULT_BUDGET: OperationBudget = {
  maxTokens: 50000,
  maxTimeMs: 600000, // 10 minutes
  maxApiCalls: 100,
};
