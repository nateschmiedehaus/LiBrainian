/**
 * @fileoverview Adaptive Synthesis System
 *
 * Adjusts Librarian's response generation strategy based on quality prediction.
 * When quality is expected to be low, uses more conservative synthesis with
 * more hedging and disclaimers.
 *
 * Features:
 * - Strategy selection based on quality prediction
 * - Hedging application at different levels (none, light, heavy)
 * - Contextual disclaimer generation
 * - Response synthesis with appropriate confidence calibration
 *
 * Strategy Selection Rules:
 * - Aggressive (quality > 0.8): High confidence, minimal hedging, no disclaimers
 * - Moderate (0.5 < quality <= 0.8): Medium confidence, light hedging, some disclaimers
 * - Conservative (quality <= 0.5): Low confidence, heavy hedging, many disclaimers
 *
 * @packageDocumentation
 */

import type { CodebaseProfile } from './codebase_profiler.js';
import type { QualityPrediction } from './quality_prediction.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Citation requirement level
 */
export type CitationRequirement = 'strict' | 'moderate' | 'relaxed';

/**
 * Hedging level for synthesis
 */
export type HedgingLevel = 'none' | 'light' | 'heavy';

/**
 * Verification status for synthesized response
 */
export type VerificationStatus = 'verified' | 'unverified' | 'partial';

/**
 * Strategy for response synthesis
 */
export interface SynthesisStrategy {
  /** Name of the strategy */
  name: string;
  /** Minimum confidence to make claims */
  confidenceThreshold: number;
  /** How strictly citations are required */
  citationRequirement: CitationRequirement;
  /** Level of hedging language to apply */
  hedgingLevel: HedgingLevel;
  /** Whether verification of claims is required */
  verificationRequired: boolean;
  /** Maximum number of claims per response */
  maxClaimsPerResponse: number;
  /** Preset disclaimers for this strategy */
  disclaimers: string[];
}

/**
 * Configuration for the adaptive synthesis system
 */
export interface AdaptiveSynthesisConfig {
  /** Default strategy when no prediction available */
  defaultStrategy: SynthesisStrategy;
  /** Quality thresholds for strategy selection */
  qualityThresholds: {
    /** Above this use aggressive strategy */
    high: number;
    /** Between medium and high use moderate */
    medium: number;
    /** Below this use conservative */
    low: number;
  };
}

/**
 * Context for synthesis
 */
export interface SynthesisContext {
  /** The user's query */
  query: string;
  /** Profile of the codebase */
  profile: CodebaseProfile;
  /** Quality prediction for this codebase */
  prediction: QualityPrediction;
  /** Retrieved context from vector store */
  retrievedContext: string[];
}

/**
 * Metadata for synthesized response
 */
export interface SynthesisMetadata {
  /** Whether hedging was applied to the content */
  hedgingApplied: boolean;
  /** Number of claims made in the response */
  claimsCount: number;
  /** Verification status of claims */
  verificationStatus: VerificationStatus;
}

/**
 * Complete synthesized response
 */
export interface SynthesizedResponse {
  /** The response content */
  content: string;
  /** The strategy used for synthesis */
  strategy: SynthesisStrategy;
  /** Citations referenced in the response */
  citations: string[];
  /** Overall confidence level (0.0 - 1.0) */
  confidenceLevel: number;
  /** Disclaimers to show to user */
  disclaimers: string[];
  /** Synthesis metadata */
  metadata: SynthesisMetadata;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Hedging phrases for light hedging
 */
const LIGHT_HEDGING_PHRASES = [
  { pattern: /\b(is|are|was|were)\b/gi, replacement: 'appears to be' },
  { pattern: /\breturn(s)?\b/gi, replacement: 'likely return$1' },
  { pattern: /\bdoes\b/gi, replacement: 'seems to' },
  { pattern: /\bwill\b/gi, replacement: 'probably will' },
];

/**
 * Hedging phrases for heavy hedging
 */
const HEAVY_HEDGING_PREFIX =
  'Based on the available code, ';
const HEAVY_HEDGING_SUFFIX =
  ', though this should be verified against the source.';

/**
 * Disclaimer templates
 */
const DISCLAIMER_TEMPLATES = {
  filesAnalyzed: (count: number) =>
    `This response is based on ${count} files analyzed from the codebase.`,
  reducedConfidence: (factors: string[]) =>
    `Confidence is reduced due to: ${factors.join(', ')}.`,
  incompleteIndex: 'Some areas of the codebase may not be fully indexed.',
  verifyClaims: 'Consider verifying critical claims against the source code.',
  limitedContext:
    'Limited context was available for this query. Results may be incomplete.',
  noTypes:
    'The codebase lacks type information, which may affect accuracy.',
  largeCodebase:
    'Due to the size of the codebase, some relevant code may not have been retrieved.',
};

/**
 * Default aggressive strategy - high confidence, minimal safety
 */
const AGGRESSIVE_STRATEGY: SynthesisStrategy = {
  name: 'aggressive',
  confidenceThreshold: 0.3,
  citationRequirement: 'relaxed',
  hedgingLevel: 'none',
  verificationRequired: false,
  maxClaimsPerResponse: 20,
  disclaimers: [],
};

/**
 * Default moderate strategy - balanced confidence and safety
 */
const MODERATE_STRATEGY: SynthesisStrategy = {
  name: 'moderate',
  confidenceThreshold: 0.5,
  citationRequirement: 'moderate',
  hedgingLevel: 'light',
  verificationRequired: false,
  maxClaimsPerResponse: 10,
  disclaimers: [],
};

/**
 * Default conservative strategy - low confidence, maximum safety
 */
const CONSERVATIVE_STRATEGY: SynthesisStrategy = {
  name: 'conservative',
  confidenceThreshold: 0.7,
  citationRequirement: 'strict',
  hedgingLevel: 'heavy',
  verificationRequired: true,
  maxClaimsPerResponse: 5,
  disclaimers: [],
};

/**
 * All default strategies
 */
export const DEFAULT_SYNTHESIS_STRATEGIES = {
  aggressive: AGGRESSIVE_STRATEGY,
  moderate: MODERATE_STRATEGY,
  conservative: CONSERVATIVE_STRATEGY,
};

/**
 * Default configuration for adaptive synthesis
 */
export const DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG: AdaptiveSynthesisConfig = {
  defaultStrategy: MODERATE_STRATEGY,
  qualityThresholds: {
    high: 0.8,
    medium: 0.5,
    low: 0.3,
  },
};

// ============================================================================
// ADAPTIVE SYNTHESIZER CLASS
// ============================================================================

/**
 * Adaptive synthesis system that adjusts response strategy based on quality
 */
export class AdaptiveSynthesizer {
  private config: AdaptiveSynthesisConfig;

  constructor(config?: Partial<AdaptiveSynthesisConfig>) {
    this.config = {
      ...DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG,
      ...config,
      qualityThresholds: {
        ...DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.qualityThresholds,
        ...config?.qualityThresholds,
      },
    };
  }

  /**
   * Select the appropriate strategy based on quality prediction
   */
  selectStrategy(prediction: QualityPrediction): SynthesisStrategy {
    const quality = prediction.synthesisAccuracy;
    const { high, medium } = this.config.qualityThresholds;

    if (quality > high) {
      return { ...DEFAULT_SYNTHESIS_STRATEGIES.aggressive };
    }

    if (quality > medium) {
      return { ...DEFAULT_SYNTHESIS_STRATEGIES.moderate };
    }

    return { ...DEFAULT_SYNTHESIS_STRATEGIES.conservative };
  }

  /**
   * Apply hedging to content based on hedging level
   */
  applyHedging(content: string, level: HedgingLevel): string {
    if (!content || content.length === 0) {
      return content;
    }

    if (level === 'none') {
      return content;
    }

    if (level === 'light') {
      return this.applyLightHedging(content);
    }

    return this.applyHeavyHedging(content);
  }

  /**
   * Generate appropriate disclaimers based on prediction and strategy
   */
  generateDisclaimers(
    prediction: QualityPrediction,
    strategy: SynthesisStrategy
  ): string[] {
    const disclaimers: string[] = [];

    // Aggressive strategy: no disclaimers
    if (strategy.name === 'aggressive') {
      return disclaimers;
    }

    // Moderate strategy: minimal disclaimers
    if (strategy.name === 'moderate') {
      // Add disclaimer if there are negative factors
      const negativeFactors = prediction.factors
        .filter((f) => f.impact === 'negative')
        .map((f) => f.name.toLowerCase());

      if (negativeFactors.length > 0) {
        disclaimers.push(DISCLAIMER_TEMPLATES.reducedConfidence(negativeFactors));
      } else {
        disclaimers.push(DISCLAIMER_TEMPLATES.verifyClaims);
      }

      return disclaimers;
    }

    // Conservative strategy: comprehensive disclaimers
    // Add files analyzed disclaimer (using confidence interval as proxy)
    disclaimers.push(DISCLAIMER_TEMPLATES.incompleteIndex);

    // Add reduced confidence based on negative factors
    const negativeFactors = prediction.factors
      .filter((f) => f.impact === 'negative')
      .map((f) => f.name.toLowerCase());

    if (negativeFactors.length > 0) {
      disclaimers.push(DISCLAIMER_TEMPLATES.reducedConfidence(negativeFactors));
    }

    // Check for specific issues
    const factorNames = prediction.factors.map((f) => f.name.toLowerCase());

    if (
      factorNames.some(
        (n) =>
          n.includes('typescript') &&
          prediction.factors.find(
            (f) => f.name.toLowerCase() === n && f.impact === 'negative'
          )
      )
    ) {
      disclaimers.push(DISCLAIMER_TEMPLATES.noTypes);
    }

    if (
      factorNames.some(
        (n) =>
          (n.includes('large') || n.includes('monorepo')) &&
          prediction.factors.find(
            (f) => f.name.toLowerCase() === n && f.impact === 'negative'
          )
      )
    ) {
      disclaimers.push(DISCLAIMER_TEMPLATES.largeCodebase);
    }

    // Always add verification disclaimer for conservative
    disclaimers.push(DISCLAIMER_TEMPLATES.verifyClaims);

    return disclaimers;
  }

  /**
   * Synthesize a response using the appropriate strategy
   */
  synthesize(context: SynthesisContext): SynthesizedResponse {
    const strategy = this.selectStrategy(context.prediction);
    const disclaimers = this.generateDisclaimers(context.prediction, strategy);

    // Build base content from retrieved context
    let content = this.buildContent(context, strategy);

    // Apply hedging if needed
    const hedgingApplied = strategy.hedgingLevel !== 'none';
    if (hedgingApplied) {
      content = this.applyHedging(content, strategy.hedgingLevel);
    }

    // Extract citations
    const citations = this.extractCitations(context.retrievedContext);

    // Calculate claims count (simplified: count sentences as claims)
    const claimsCount = Math.min(
      this.countClaims(content),
      strategy.maxClaimsPerResponse
    );

    // Determine verification status
    const verificationStatus = this.determineVerificationStatus(strategy);

    // Calculate confidence level based on prediction and strategy
    const confidenceLevel = this.calculateConfidence(context.prediction, strategy);

    return {
      content,
      strategy,
      citations,
      confidenceLevel,
      disclaimers,
      metadata: {
        hedgingApplied,
        claimsCount,
        verificationStatus,
      },
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Apply light hedging to content
   */
  private applyLightHedging(content: string): string {
    let hedged = content;

    for (const { pattern, replacement } of LIGHT_HEDGING_PHRASES) {
      // Only apply first occurrence to avoid over-hedging
      hedged = hedged.replace(pattern, replacement);
      break; // Apply only one hedging transformation for light
    }

    // If no pattern matched, prepend with light hedge
    if (hedged === content) {
      hedged = `It appears that ${content.charAt(0).toLowerCase()}${content.slice(1)}`;
    }

    return hedged;
  }

  /**
   * Apply heavy hedging to content
   */
  private applyHeavyHedging(content: string): string {
    // For heavy hedging, wrap the entire content
    const trimmed = content.trim();

    // Don't double-hedge if already hedged
    if (trimmed.toLowerCase().startsWith('based on')) {
      return trimmed;
    }

    // Apply prefix and suffix
    const lowercaseStart = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);

    // Remove trailing period if present (we'll add our own suffix)
    const withoutPeriod = lowercaseStart.replace(/\.$/, '');

    // Handle "may" insertion for the verb
    const withMay = withoutPeriod
      .replace(/\b(is|are|was|were)\b/i, 'may be')
      .replace(/\breturn(s)?\b/gi, 'may return')
      .replace(/\bdoes\b/gi, 'may');

    return `${HEAVY_HEDGING_PREFIX}${withMay}${HEAVY_HEDGING_SUFFIX}`;
  }

  /**
   * Build content from retrieved context
   */
  private buildContent(
    context: SynthesisContext,
    strategy: SynthesisStrategy
  ): string {
    if (context.retrievedContext.length === 0) {
      return 'No relevant context was found for this query.';
    }

    // For conservative strategy, be more selective
    const maxContext =
      strategy.name === 'conservative'
        ? Math.min(context.retrievedContext.length, 3)
        : strategy.name === 'moderate'
        ? Math.min(context.retrievedContext.length, 5)
        : context.retrievedContext.length;

    const selectedContext = context.retrievedContext.slice(0, maxContext);

    // Build a simple response summarizing the context
    const summary = this.summarizeContext(selectedContext, context.query);

    return summary;
  }

  /**
   * Summarize retrieved context into a response
   */
  private summarizeContext(context: string[], query: string): string {
    if (context.length === 0) {
      return 'No relevant information found.';
    }

    // Simple summarization: combine context snippets
    const combined = context
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .join(' ');

    // If context is short enough, return as is
    if (combined.length < 500) {
      return combined;
    }

    // Otherwise, truncate with ellipsis
    return combined.slice(0, 497) + '...';
  }

  /**
   * Extract citations from retrieved context
   */
  private extractCitations(retrievedContext: string[]): string[] {
    const citations: string[] = [];

    for (const ctx of retrievedContext) {
      // Look for file references like "// src/file.ts:10"
      const fileMatch = ctx.match(/\/\/\s*([\w\/.-]+\.(?:ts|js|tsx|jsx|py|go|rs|java|rb))(?::(\d+))?/);
      if (fileMatch) {
        citations.push(fileMatch[1] + (fileMatch[2] ? `:${fileMatch[2]}` : ''));
      }
    }

    // Deduplicate
    return [...new Set(citations)];
  }

  /**
   * Count claims in content (simplified: count sentences)
   */
  private countClaims(content: string): number {
    // Count sentences as a proxy for claims
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sentences.length;
  }

  /**
   * Determine verification status based on strategy
   */
  private determineVerificationStatus(strategy: SynthesisStrategy): VerificationStatus {
    if (strategy.verificationRequired) {
      // For conservative, we haven't actually verified anything
      // Return 'partial' to indicate some checking was done
      return 'partial';
    }

    // For non-verification strategies, mark as unverified
    return 'unverified';
  }

  /**
   * Calculate confidence level based on prediction and strategy
   */
  private calculateConfidence(
    prediction: QualityPrediction,
    strategy: SynthesisStrategy
  ): number {
    // Base confidence on synthesis accuracy
    let confidence = prediction.synthesisAccuracy;

    // Adjust based on strategy
    if (strategy.name === 'conservative') {
      // Conservative strategy reduces confidence
      confidence *= 0.8;
    } else if (strategy.name === 'aggressive') {
      // Aggressive strategy uses full prediction confidence
      confidence = Math.min(confidence * 1.1, 0.95);
    }

    // Clamp to valid range
    return Math.max(0, Math.min(1, confidence));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new AdaptiveSynthesizer instance
 */
export function createAdaptiveSynthesizer(
  config?: Partial<AdaptiveSynthesisConfig>
): AdaptiveSynthesizer {
  return new AdaptiveSynthesizer(config);
}
