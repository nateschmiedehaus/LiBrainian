/**
 * @fileoverview Intuitive Grounding System
 *
 * Implements intuitive grounding for the epistemic framework, allowing representation
 * of expert intuition, pattern recognition, heuristics, and other forms of tacit knowledge.
 *
 * This module extends the grounding system to capture epistemic states that are:
 * - Based on pattern recognition without explicit reasoning
 * - Derived from experience or expertise
 * - Founded on analogical reasoning
 * - Rooted in gestalt perception
 *
 * Key features:
 * - IntuitiveGrounding type with articulability tracking
 * - Upgrade paths from intuitive to more rigorous grounding types
 * - Pattern detection and analogy-based reasoning helpers
 * - Calibration-aware confidence handling
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type {
  ContentType,
  GroundingType,
  ExtendedGroundingType,
  GradedStrength,
  Grounding,
  ObjectId,
  GroundingId,
  Content,
} from './universal_coherence.js';
import {
  createGroundingId,
  constructContent,
  constructGrounding,
} from './universal_coherence.js';
import type { ConfidenceValue } from './confidence.js';
import { bounded, absent } from './confidence.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for intuitive grounding types */
export const INTUITIVE_GROUNDING_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// EXTENDED GROUNDING TYPE
// ============================================================================

/**
 * Extended GroundingType union that includes 'intuitive'.
 *
 * This extends the base GroundingType to include intuitive grounding,
 * which represents expert judgment without explicit reasoning.
 */
export type ExtendedGroundingTypeWithIntuitive =
  | GroundingType
  | ExtendedGroundingType
  | 'intuitive';

// ============================================================================
// INTUITIVE SOURCE TYPES
// ============================================================================

/**
 * Sources of intuitive grounding.
 *
 * - pattern_recognition: Recognition of familiar patterns from prior experience
 * - heuristic: Application of mental shortcuts or rules of thumb
 * - experience: Judgment based on accumulated domain expertise
 * - analogy: Reasoning by similarity to known cases
 * - gestalt: Holistic perception of a situation
 */
export type IntuitiveSource =
  | 'pattern_recognition'
  | 'heuristic'
  | 'experience'
  | 'analogy'
  | 'gestalt';

/**
 * Articulability levels for intuitive knowledge.
 *
 * - explicit: Can be fully articulated in words
 * - tacit: Partially articulable, some aspects resist verbalization
 * - ineffable: Cannot be articulated, purely experiential
 */
export type Articulability = 'explicit' | 'tacit' | 'ineffable';

// ============================================================================
// UPGRADE PATH TYPES
// ============================================================================

/**
 * Describes a potential upgrade path from intuitive to more rigorous grounding.
 *
 * Intuitive groundings can be strengthened by gathering evidence that
 * transforms them into more rigorous grounding types.
 */
export interface UpgradePath {
  /** The target grounding type this path leads to */
  readonly targetType: GroundingType;

  /** Evidence required to complete the upgrade */
  readonly requiredEvidence: readonly string[];

  /** Confidence boost upon successful upgrade (additive) */
  readonly confidenceBoost: number;

  /** Description of what this upgrade path represents */
  readonly description?: string;
}

// ============================================================================
// INTUITIVE GROUNDING INTERFACE
// ============================================================================

/**
 * IntuitiveGrounding - represents expert intuition as epistemic grounding.
 *
 * This interface captures the unique characteristics of intuitive knowledge:
 * - Source: Where the intuition comes from
 * - Articulability: How well it can be expressed in words
 * - Upgrade paths: How it can be strengthened with evidence
 *
 * Default confidence ranges from 0.4-0.6, lower than inferential grounding,
 * reflecting the inherent uncertainty in unarticulated judgment.
 */
export interface IntuitiveGrounding extends Omit<Grounding, 'type'> {
  /** Grounding type is always 'intuitive' */
  readonly type: 'intuitive';

  /** Source of the intuitive judgment */
  readonly source: IntuitiveSource;

  /** How well the intuition can be articulated */
  readonly articulability: Articulability;

  /** Possible paths to upgrade this to a more rigorous grounding */
  readonly upgradePaths: readonly UpgradePath[];

  /** Optional basis or rationale for the intuition */
  readonly basis?: string;

  /** Domain expertise level (years of experience) if applicable */
  readonly expertiseLevel?: number;

  /** Track record calibration data if available */
  readonly calibrationData?: {
    readonly totalPredictions: number;
    readonly correctPredictions: number;
    readonly domain: string;
  };
}

// ============================================================================
// EVIDENCE TYPES
// ============================================================================

/**
 * Evidence that can be used to upgrade intuitive grounding.
 */
export interface Evidence {
  /** Unique identifier for this evidence */
  readonly id: string;

  /** Type of evidence */
  readonly type: string;

  /** Description of what this evidence establishes */
  readonly description: string;

  /** Strength of this evidence */
  readonly strength: number;

  /** When this evidence was gathered */
  readonly gatheredAt?: string;
}

// ============================================================================
// DEFAULT CONFIDENCE VALUES
// ============================================================================

/**
 * Default confidence values by intuitive source.
 *
 * These reflect typical confidence levels for different types of intuition:
 * - pattern_recognition: 0.55 - Familiar patterns tend to be reliable
 * - heuristic: 0.50 - Rules of thumb have known limitations
 * - experience: 0.60 - Domain expertise provides better calibration
 * - analogy: 0.45 - Analogies may miss important differences
 * - gestalt: 0.40 - Holistic perception is hardest to verify
 */
export const DEFAULT_INTUITIVE_CONFIDENCE: Record<IntuitiveSource, number> = {
  pattern_recognition: 0.55,
  heuristic: 0.50,
  experience: 0.60,
  analogy: 0.45,
  gestalt: 0.40,
};

/**
 * Confidence range bounds for intuitive grounding.
 */
export const INTUITIVE_CONFIDENCE_BOUNDS = {
  min: 0.3,
  max: 0.7,
  defaultLow: 0.4,
  defaultHigh: 0.6,
} as const;

// ============================================================================
// DEFAULT UPGRADE PATHS
// ============================================================================

/**
 * Default upgrade paths by source type.
 */
export const DEFAULT_UPGRADE_PATHS: Record<IntuitiveSource, readonly UpgradePath[]> = {
  pattern_recognition: [
    {
      targetType: 'evidential',
      requiredEvidence: ['historical_data', 'pattern_validation'],
      confidenceBoost: 0.2,
      description: 'Validate pattern with historical data',
    },
    {
      targetType: 'inferential',
      requiredEvidence: ['explicit_rules', 'logical_derivation'],
      confidenceBoost: 0.25,
      description: 'Formalize pattern as explicit inference rules',
    },
  ],
  heuristic: [
    {
      targetType: 'evidential',
      requiredEvidence: ['empirical_validation', 'success_rate_data'],
      confidenceBoost: 0.15,
      description: 'Validate heuristic with empirical data',
    },
    {
      targetType: 'inferential',
      requiredEvidence: ['formal_justification', 'boundary_conditions'],
      confidenceBoost: 0.2,
      description: 'Provide formal justification for the heuristic',
    },
  ],
  experience: [
    {
      targetType: 'testimonial',
      requiredEvidence: ['documented_experience', 'peer_validation'],
      confidenceBoost: 0.1,
      description: 'Document and validate experience with peers',
    },
    {
      targetType: 'evidential',
      requiredEvidence: ['outcome_tracking', 'calibration_data'],
      confidenceBoost: 0.2,
      description: 'Track outcomes to build calibration data',
    },
  ],
  analogy: [
    {
      targetType: 'explanatory',
      requiredEvidence: ['structural_mapping', 'difference_analysis'],
      confidenceBoost: 0.2,
      description: 'Formalize the structural mapping between domains',
    },
    {
      targetType: 'inferential',
      requiredEvidence: ['shared_principles', 'domain_transfer_validation'],
      confidenceBoost: 0.25,
      description: 'Identify shared principles that justify the transfer',
    },
  ],
  gestalt: [
    {
      targetType: 'perceptual',
      requiredEvidence: ['detailed_observations', 'component_analysis'],
      confidenceBoost: 0.15,
      description: 'Break down holistic perception into components',
    },
    {
      targetType: 'evidential',
      requiredEvidence: ['multiple_observations', 'independent_validation'],
      confidenceBoost: 0.2,
      description: 'Validate with multiple independent observations',
    },
  ],
};

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an intuitive grounding from content.
 *
 * @param from - The source object providing the intuitive ground
 * @param to - The object being grounded
 * @param source - The type of intuitive source
 * @param options - Additional options
 * @returns An IntuitiveGrounding object
 *
 * @example
 * ```typescript
 * const grounding = createIntuitiveGrounding(
 *   expertJudgment.id,
 *   codeQuality.id,
 *   'experience',
 *   { basis: '20 years of code review experience' }
 * );
 * ```
 */
export function createIntuitiveGrounding(
  from: ObjectId,
  to: ObjectId,
  source: IntuitiveSource,
  options: {
    basis?: string;
    articulability?: Articulability;
    upgradePaths?: readonly UpgradePath[];
    strength?: GradedStrength;
    expertiseLevel?: number;
    calibrationData?: IntuitiveGrounding['calibrationData'];
    explanation?: string;
  } = {}
): IntuitiveGrounding {
  const confidence = options.strength?.value ?? getDefaultConfidence(source);
  const articulability = options.articulability ?? inferArticulability(source);

  return {
    id: createGroundingId('intuitive'),
    from,
    to,
    type: 'intuitive',
    source,
    articulability,
    upgradePaths: options.upgradePaths ?? DEFAULT_UPGRADE_PATHS[source],
    strength: options.strength ?? {
      value: confidence,
      basis: 'estimated',
    },
    active: true,
    basis: options.basis,
    expertiseLevel: options.expertiseLevel,
    calibrationData: options.calibrationData,
    explanation: options.explanation,
  };
}

/**
 * Get the default confidence value for an intuitive source.
 *
 * @param source - The intuitive source type
 * @returns Default confidence value (0.4-0.6 range)
 */
export function getDefaultConfidence(source: IntuitiveSource): number {
  return DEFAULT_INTUITIVE_CONFIDENCE[source];
}

/**
 * Infer articulability from the source type.
 */
function inferArticulability(source: IntuitiveSource): Articulability {
  switch (source) {
    case 'pattern_recognition':
      return 'tacit';
    case 'heuristic':
      return 'explicit';
    case 'experience':
      return 'tacit';
    case 'analogy':
      return 'explicit';
    case 'gestalt':
      return 'ineffable';
  }
}

// ============================================================================
// UPGRADE FUNCTIONS
// ============================================================================

/**
 * Check if an intuitive grounding can be upgraded with available evidence.
 *
 * @param grounding - The intuitive grounding to check
 * @param availableEvidence - Array of evidence type strings available
 * @returns True if any upgrade path can be completed
 *
 * @example
 * ```typescript
 * const canUpgrade = canUpgrade(intuition, ['historical_data', 'pattern_validation']);
 * if (canUpgrade) {
 *   const upgraded = upgradeGrounding(intuition, evidence);
 * }
 * ```
 */
export function canUpgrade(
  grounding: IntuitiveGrounding,
  availableEvidence: readonly string[]
): boolean {
  const evidenceSet = new Set(availableEvidence);

  for (const path of grounding.upgradePaths) {
    const hasAllEvidence = path.requiredEvidence.every((e) => evidenceSet.has(e));
    if (hasAllEvidence) {
      return true;
    }
  }

  return false;
}

/**
 * Find the best upgrade path that can be completed with available evidence.
 *
 * @param grounding - The intuitive grounding to upgrade
 * @param availableEvidence - Array of evidence available
 * @returns The best upgrade path, or null if none can be completed
 */
export function findBestUpgradePath(
  grounding: IntuitiveGrounding,
  availableEvidence: readonly Evidence[]
): UpgradePath | null {
  const evidenceTypes = new Set(availableEvidence.map((e) => e.type));
  let bestPath: UpgradePath | null = null;
  let bestBoost = -1;

  for (const path of grounding.upgradePaths) {
    const hasAllEvidence = path.requiredEvidence.every((e) => evidenceTypes.has(e));
    if (hasAllEvidence && path.confidenceBoost > bestBoost) {
      bestPath = path;
      bestBoost = path.confidenceBoost;
    }
  }

  return bestPath;
}

/**
 * Upgrade an intuitive grounding to a more rigorous type using evidence.
 *
 * @param grounding - The intuitive grounding to upgrade
 * @param evidence - Array of evidence supporting the upgrade
 * @returns A new Grounding with upgraded type and boosted confidence
 * @throws Error if no upgrade path can be completed with the evidence
 *
 * @example
 * ```typescript
 * const evidence = [
 *   { id: 'e1', type: 'historical_data', description: '...', strength: 0.8 },
 *   { id: 'e2', type: 'pattern_validation', description: '...', strength: 0.7 },
 * ];
 * const upgraded = upgradeGrounding(intuition, evidence);
 * // Returns a grounding with type 'evidential' and boosted confidence
 * ```
 */
export function upgradeGrounding(
  grounding: IntuitiveGrounding,
  evidence: readonly Evidence[]
): Grounding {
  const upgradePath = findBestUpgradePath(grounding, evidence);

  if (!upgradePath) {
    throw new Error(
      `Cannot upgrade intuitive grounding: insufficient evidence. ` +
      `Available: [${evidence.map((e) => e.type).join(', ')}]. ` +
      `Required for any path: ${grounding.upgradePaths
        .map((p) => `[${p.requiredEvidence.join(', ')}]`)
        .join(' or ')}`
    );
  }

  // Calculate new confidence with boost
  const baseConfidence = grounding.strength.value;
  const evidenceStrength = evidence.reduce((sum, e) => sum + e.strength, 0) / evidence.length;
  const boostedConfidence = Math.min(
    1.0,
    baseConfidence + upgradePath.confidenceBoost * evidenceStrength
  );

  // Create the upgraded grounding
  return constructGrounding(
    grounding.from,
    grounding.to,
    upgradePath.targetType,
    {
      value: boostedConfidence,
      basis: 'derived',
    },
    {
      explanation: `Upgraded from intuitive (${grounding.source}) via ${upgradePath.description ?? 'evidence collection'}`,
    }
  );
}

// ============================================================================
// ARTICULABILITY FUNCTIONS
// ============================================================================

/**
 * Check if an intuitive grounding is articulable.
 *
 * @param grounding - The grounding to check
 * @returns True if the grounding is explicit or tacit (not ineffable)
 */
export function isArticulable(grounding: IntuitiveGrounding): boolean {
  return grounding.articulability !== 'ineffable';
}

/**
 * Get articulability level as a numeric value.
 *
 * @param articulability - The articulability level
 * @returns Numeric value: explicit=1.0, tacit=0.5, ineffable=0.0
 */
export function getArticulabilityScore(articulability: Articulability): number {
  switch (articulability) {
    case 'explicit':
      return 1.0;
    case 'tacit':
      return 0.5;
    case 'ineffable':
      return 0.0;
  }
}

// ============================================================================
// PATTERN RECOGNITION HELPERS
// ============================================================================

/**
 * Attempt to detect a pattern from a series of observations.
 *
 * This function analyzes content items to identify recurring patterns
 * and creates an intuitive grounding if a pattern is found.
 *
 * @param observations - Array of content observations to analyze
 * @param options - Options for pattern detection
 * @returns An IntuitiveGrounding representing the detected pattern, or null
 *
 * @example
 * ```typescript
 * const observations = [
 *   constructContent('Bug found in authentication'),
 *   constructContent('Bug found in authorization'),
 *   constructContent('Bug found in session management'),
 * ];
 * const pattern = detectPattern(observations, { minOccurrences: 3 });
 * // Returns grounding: "Security-related components have bugs"
 * ```
 */
export function detectPattern(
  observations: readonly Content[],
  options: {
    minOccurrences?: number;
    confidenceThreshold?: number;
    targetObjectId?: ObjectId;
  } = {}
): IntuitiveGrounding | null {
  const minOccurrences = options.minOccurrences ?? 3;
  const confidenceThreshold = options.confidenceThreshold ?? 0.4;

  if (observations.length < minOccurrences) {
    return null;
  }

  // Simple pattern detection: look for common content types or value patterns
  const contentTypes = new Map<ContentType, number>();
  const valuePatterns = new Map<string, number>();

  for (const obs of observations) {
    // Count content types
    contentTypes.set(
      obs.contentType,
      (contentTypes.get(obs.contentType) ?? 0) + 1
    );

    // Extract simple patterns from string values
    if (typeof obs.value === 'string') {
      // Extract key terms (simplified)
      const terms = obs.value.toLowerCase().split(/\s+/);
      for (const term of terms) {
        if (term.length > 3) {
          valuePatterns.set(term, (valuePatterns.get(term) ?? 0) + 1);
        }
      }
    }
  }

  // Find the most common content type
  let dominantType: ContentType | null = null;
  let maxTypeCount = 0;
  for (const [type, count] of contentTypes) {
    if (count >= minOccurrences && count > maxTypeCount) {
      dominantType = type;
      maxTypeCount = count;
    }
  }

  // Find recurring terms
  const recurringTerms: string[] = [];
  for (const [term, count] of valuePatterns) {
    if (count >= minOccurrences) {
      recurringTerms.push(term);
    }
  }

  // If no pattern found, return null
  if (dominantType === null && recurringTerms.length === 0) {
    return null;
  }

  // Calculate confidence based on pattern strength
  const typeRatio = maxTypeCount / observations.length;
  const termCoverage = recurringTerms.length > 0
    ? Math.min(1, recurringTerms.length / 5)
    : 0;
  const confidence = Math.max(
    confidenceThreshold,
    Math.min(INTUITIVE_CONFIDENCE_BOUNDS.max, (typeRatio + termCoverage) / 2)
  );

  // Create pattern content for the 'from' object
  // In practice, you would have the actual object IDs
  const fromId = options.targetObjectId ?? (`pattern_${randomUUID()}` as ObjectId);
  const toId = `conclusion_${randomUUID()}` as ObjectId;

  const patternDescription = [
    dominantType ? `Dominant content type: ${dominantType}` : '',
    recurringTerms.length > 0 ? `Recurring terms: ${recurringTerms.slice(0, 5).join(', ')}` : '',
  ].filter(Boolean).join('. ');

  return createIntuitiveGrounding(
    fromId,
    toId,
    'pattern_recognition',
    {
      basis: patternDescription,
      strength: {
        value: confidence,
        basis: 'derived',
      },
      explanation: `Pattern detected from ${observations.length} observations`,
    }
  );
}

/**
 * Create an intuitive grounding based on analogy to prior cases.
 *
 * @param current - The current content to reason about
 * @param priors - Array of prior content cases to draw analogies from
 * @param options - Options for analogy detection
 * @returns An IntuitiveGrounding based on analogy, or null if no analogy found
 *
 * @example
 * ```typescript
 * const current = constructContent('New microservice deployment');
 * const priors = [
 *   constructContent('Previous successful microservice deployment'),
 *   constructContent('Another microservice deployment'),
 * ];
 * const analogy = analogyFromPrior(current, priors, { similarityThreshold: 0.6 });
 * ```
 */
export function analogyFromPrior(
  current: Content,
  priors: readonly Content[],
  options: {
    similarityThreshold?: number;
    maxAnalogies?: number;
    targetObjectId?: ObjectId;
  } = {}
): IntuitiveGrounding | null {
  const similarityThreshold = options.similarityThreshold ?? 0.5;
  const maxAnalogies = options.maxAnalogies ?? 3;

  if (priors.length === 0) {
    return null;
  }

  // Calculate similarity scores
  const similarities: Array<{ prior: Content; score: number }> = [];

  for (const prior of priors) {
    const score = calculateSimilarity(current, prior);
    if (score >= similarityThreshold) {
      similarities.push({ prior, score });
    }
  }

  if (similarities.length === 0) {
    return null;
  }

  // Sort by similarity and take top matches
  similarities.sort((a, b) => b.score - a.score);
  const topMatches = similarities.slice(0, maxAnalogies);

  // Calculate confidence based on similarity scores
  const avgSimilarity = topMatches.reduce((sum, m) => sum + m.score, 0) / topMatches.length;
  const confidence = Math.min(
    INTUITIVE_CONFIDENCE_BOUNDS.max,
    Math.max(
      INTUITIVE_CONFIDENCE_BOUNDS.min,
      avgSimilarity * DEFAULT_INTUITIVE_CONFIDENCE.analogy + 0.1
    )
  );

  const fromId = options.targetObjectId ?? (`analogy_${randomUUID()}` as ObjectId);
  const toId = `inferred_${randomUUID()}` as ObjectId;

  return createIntuitiveGrounding(
    fromId,
    toId,
    'analogy',
    {
      basis: `Analogy based on ${topMatches.length} similar prior case(s) with avg similarity ${avgSimilarity.toFixed(2)}`,
      articulability: 'explicit',
      strength: {
        value: confidence,
        basis: 'derived',
      },
      explanation: `Reasoning by analogy from ${topMatches.length} prior cases`,
    }
  );
}

/**
 * Calculate similarity between two content items.
 *
 * This is a simplified similarity measure based on:
 * - Content type matching
 * - Value similarity (for strings)
 * - Hash comparison (for exact matches)
 */
function calculateSimilarity(a: Content, b: Content): number {
  let score = 0;

  // Content type matching
  if (a.contentType === b.contentType) {
    score += 0.3;
  }

  // Hash comparison for exact matches
  if (a.hash === b.hash) {
    return 1.0;
  }

  // Value similarity for strings
  if (typeof a.value === 'string' && typeof b.value === 'string') {
    const termsA = new Set(a.value.toLowerCase().split(/\s+/));
    const termsB = new Set(b.value.toLowerCase().split(/\s+/));

    const intersection = [...termsA].filter((t) => termsB.has(t)).length;
    const union = new Set([...termsA, ...termsB]).size;

    if (union > 0) {
      score += 0.7 * (intersection / union); // Jaccard similarity
    }
  }

  return Math.min(1, score);
}

// ============================================================================
// CONFIDENCE CONVERSION
// ============================================================================

/**
 * Convert an IntuitiveGrounding to a ConfidenceValue.
 *
 * @param grounding - The intuitive grounding
 * @returns A bounded ConfidenceValue reflecting the intuitive nature
 */
export function toConfidenceValue(grounding: IntuitiveGrounding): ConfidenceValue {
  const baseValue = grounding.strength.value;

  // If calibration data exists, we can be more precise
  if (grounding.calibrationData && grounding.calibrationData.totalPredictions > 10) {
    const accuracy = grounding.calibrationData.correctPredictions /
      grounding.calibrationData.totalPredictions;
    return bounded(
      Math.max(0, accuracy - 0.1),
      Math.min(1, accuracy + 0.1),
      'literature',
      `Calibrated from ${grounding.calibrationData.totalPredictions} predictions in ${grounding.calibrationData.domain}`
    );
  }

  // For uncalibrated intuitions, use wider bounds
  const articulabilityPenalty = grounding.articulability === 'ineffable' ? 0.1 :
    grounding.articulability === 'tacit' ? 0.05 : 0;

  return bounded(
    Math.max(0, baseValue - 0.15 - articulabilityPenalty),
    Math.min(1, baseValue + 0.15),
    'theoretical',
    `Intuitive grounding (${grounding.source}): ${grounding.basis ?? 'expert judgment'}`
  );
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a grounding is an IntuitiveGrounding.
 *
 * Note: IntuitiveGrounding extends Grounding but uses 'intuitive' as its type,
 * which is not part of the base ExtendedGroundingType union. This function
 * safely checks for intuitive groundings.
 */
export function isIntuitiveGrounding(
  grounding: Grounding | IntuitiveGrounding
): grounding is IntuitiveGrounding {
  return (
    grounding !== null &&
    typeof grounding === 'object' &&
    'type' in grounding &&
    grounding.type === 'intuitive' &&
    'source' in grounding &&
    'articulability' in grounding &&
    'upgradePaths' in grounding
  );
}

/**
 * Type guard to check if a value is a valid IntuitiveSource.
 */
export function isIntuitiveSource(value: unknown): value is IntuitiveSource {
  return (
    value === 'pattern_recognition' ||
    value === 'heuristic' ||
    value === 'experience' ||
    value === 'analogy' ||
    value === 'gestalt'
  );
}

/**
 * Type guard to check if a value is a valid Articulability.
 */
export function isArticulability(value: unknown): value is Articulability {
  return value === 'explicit' || value === 'tacit' || value === 'ineffable';
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate an IntuitiveGrounding structure.
 *
 * @param grounding - The grounding to validate
 * @returns Array of validation errors, empty if valid
 */
export function validateIntuitiveGrounding(grounding: IntuitiveGrounding): string[] {
  const errors: string[] = [];

  if (grounding.type !== 'intuitive') {
    errors.push(`Expected type 'intuitive', got '${grounding.type}'`);
  }

  if (!isIntuitiveSource(grounding.source)) {
    errors.push(`Invalid intuitive source: ${grounding.source}`);
  }

  if (!isArticulability(grounding.articulability)) {
    errors.push(`Invalid articulability: ${grounding.articulability}`);
  }

  const confidence = grounding.strength.value;
  if (confidence < 0 || confidence > 1) {
    errors.push(`Confidence must be in [0, 1], got ${confidence}`);
  }

  if (confidence > INTUITIVE_CONFIDENCE_BOUNDS.max) {
    errors.push(
      `Warning: Confidence ${confidence} exceeds typical intuitive bounds (max ${INTUITIVE_CONFIDENCE_BOUNDS.max})`
    );
  }

  for (const path of grounding.upgradePaths) {
    if (path.confidenceBoost < 0 || path.confidenceBoost > 1) {
      errors.push(`Upgrade path confidence boost must be in [0, 1], got ${path.confidenceBoost}`);
    }
    if (path.requiredEvidence.length === 0) {
      errors.push(`Upgrade path to ${path.targetType} has no required evidence`);
    }
  }

  return errors;
}
