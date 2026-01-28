/**
 * @fileoverview Quality Disclosure System
 *
 * Ensures Librarian's responses include honest quality disclosures.
 * This is the user-facing component that communicates uncertainty.
 *
 * Features:
 * - Generates appropriate disclosures based on quality predictions
 * - Multiple format styles (inline, block, footer)
 * - Configurable verbosity levels
 * - Actionable recommendations for low confidence responses
 *
 * Disclosure Templates:
 * - High: Positive summary, no warnings
 * - Medium: Cautious summary, some factors listed
 * - Low: Warning summary, all factors, recommendations
 *
 * @packageDocumentation
 */

import type { QualityPrediction, QualityFactor } from './quality_prediction.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Confidence level for disclosure
 */
export type DisclosureLevel = 'high' | 'medium' | 'low';

/**
 * Verbosity level for disclosure output
 */
export type DisclosureVerbosity = 'minimal' | 'standard' | 'verbose';

/**
 * Format style for disclosure output
 */
export type DisclosureFormatStyle = 'inline' | 'block' | 'footer';

/**
 * Quality disclosure for a response
 */
export interface QualityDisclosure {
  /** Confidence level */
  level: DisclosureLevel;
  /** One-line summary */
  summary: string;
  /** Detailed factors */
  details: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** What user should do */
  recommendations: string[];
}

/**
 * Configuration for disclosure generation
 */
export interface DisclosureConfig {
  /** Verbosity level */
  verbosity: DisclosureVerbosity;
  /** Whether to include factors in output */
  includeFactors: boolean;
  /** Whether to include recommendations */
  includeRecommendations: boolean;
  /** Format style for output */
  formatStyle: DisclosureFormatStyle;
}

/**
 * Formatted disclosure output
 */
export interface FormattedDisclosure {
  /** Markdown formatted disclosure */
  markdown: string;
  /** Plain text disclosure */
  plainText: string;
  /** Original structured disclosure */
  structured: QualityDisclosure;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default disclosure configuration */
export const DEFAULT_DISCLOSURE_CONFIG: DisclosureConfig = {
  verbosity: 'standard',
  includeFactors: true,
  includeRecommendations: true,
  formatStyle: 'block',
};

/** Thresholds for confidence levels */
const CONFIDENCE_THRESHOLDS = {
  high: 0.75,
  medium: 0.5,
};

/** Emoji indicators */
const EMOJI = {
  high: '\u2713', // checkmark
  medium: '\u26A0\uFE0F', // warning
  low: '\u26A0\uFE0F', // warning
};

// ============================================================================
// TEMPLATES
// ============================================================================

/**
 * Templates for high confidence disclosures
 */
const HIGH_CONFIDENCE_TEMPLATES = {
  summary: (factors: QualityFactor[]): string => {
    const positiveFactors = factors.filter((f) => f.impact === 'positive');
    const highlights: string[] = [];

    for (const factor of positiveFactors) {
      if (factor.name.toLowerCase().includes('typescript') || factor.name.toLowerCase().includes('type')) {
        highlights.push('well-typed codebase');
      } else if (factor.name.toLowerCase().includes('test')) {
        highlights.push('tests');
      } else if (factor.name.toLowerCase().includes('documentation')) {
        highlights.push('documentation');
      }
    }

    if (highlights.length === 0) {
      return 'High confidence response based on quality codebase analysis.';
    }

    return `High confidence response based on ${highlights.join(' with ')}.`;
  },
  block: (factors: QualityFactor[]): string => {
    const positiveFactors = factors.filter((f) => f.impact === 'positive');
    const highlights: string[] = [];

    for (const factor of positiveFactors) {
      if (factor.name.toLowerCase().includes('typescript') || factor.name.toLowerCase().includes('type')) {
        highlights.push('well-typed codebase');
      } else if (factor.name.toLowerCase().includes('test')) {
        highlights.push('tests');
      } else if (factor.name.toLowerCase().includes('documentation')) {
        highlights.push('good documentation');
      } else if (factor.name.toLowerCase().includes('small')) {
        highlights.push('manageable size');
      }
    }

    const highlightText = highlights.length > 0 ? highlights.join(', ') : 'quality codebase';
    return `${EMOJI.high} High confidence response based on ${highlightText}.`;
  },
};

/**
 * Templates for medium confidence disclosures
 */
const MEDIUM_CONFIDENCE_TEMPLATES = {
  summary: 'Medium confidence - some factors may affect accuracy.',
  block: (factors: QualityFactor[]): string => {
    const negativeFactors = factors.filter((f) => f.impact === 'negative');
    let text = `${EMOJI.medium} Medium confidence - some factors may affect accuracy:\n`;

    for (const factor of negativeFactors) {
      text += `- ${factor.reason}\n`;
    }

    text += 'Consider verifying critical claims.';
    return text;
  },
  recommendation: 'Consider verifying critical claims.',
};

/**
 * Templates for low confidence disclosures
 */
const LOW_CONFIDENCE_TEMPLATES = {
  summary: 'Low confidence response - please verify.',
  block: (factors: QualityFactor[]): string => {
    const negativeFactors = factors.filter((f) => f.impact === 'negative');
    let text = `${EMOJI.low} Low confidence response - please verify:\n`;

    for (const factor of negativeFactors) {
      text += `- ${factor.reason}\n`;
    }

    text += '\nRecommendations:\n';
    text += '- Cross-reference with source code\n';
    text += '- Verify function signatures manually\n';
    text += '- Check for recent code changes';
    return text;
  },
  recommendations: [
    'Cross-reference with source code',
    'Verify function signatures manually',
    'Check for recent code changes',
  ],
};

// ============================================================================
// QUALITY DISCLOSURE GENERATOR CLASS
// ============================================================================

/**
 * Generates quality disclosures for Librarian responses
 */
export class QualityDisclosureGenerator {
  private config: DisclosureConfig;

  constructor(config: Partial<DisclosureConfig> = {}) {
    this.config = { ...DEFAULT_DISCLOSURE_CONFIG, ...config };
  }

  /**
   * Generate disclosure from prediction
   */
  generate(prediction: QualityPrediction, config?: Partial<DisclosureConfig>): QualityDisclosure {
    const mergedConfig = { ...this.config, ...config };
    const level = this.determineLevel(prediction);
    const summary = this.generateSummary(prediction, level);
    const details = this.generateDetails(prediction, level, mergedConfig);
    const recommendations = this.generateRecommendations(prediction, level, mergedConfig);
    const confidence = prediction.synthesisAccuracy;

    return {
      level,
      summary,
      details,
      confidence,
      recommendations,
    };
  }

  /**
   * Format disclosure for output
   */
  format(disclosure: QualityDisclosure, config?: Partial<DisclosureConfig>): FormattedDisclosure {
    const mergedConfig = { ...this.config, ...config };
    const markdown = this.formatMarkdown(disclosure, mergedConfig);
    const plainText = this.formatPlainText(disclosure, mergedConfig);

    return {
      markdown,
      plainText,
      structured: disclosure,
    };
  }

  /**
   * Get inline disclosure (short)
   */
  getInline(prediction: QualityPrediction): string {
    const level = this.determineLevel(prediction);
    return `(confidence: ${level})`;
  }

  /**
   * Get block disclosure (detailed)
   */
  getBlock(prediction: QualityPrediction): string {
    const level = this.determineLevel(prediction);
    const factors = prediction.factors;

    switch (level) {
      case 'high':
        return HIGH_CONFIDENCE_TEMPLATES.block(factors);
      case 'medium':
        return MEDIUM_CONFIDENCE_TEMPLATES.block(factors);
      case 'low':
        return LOW_CONFIDENCE_TEMPLATES.block(factors);
    }
  }

  /**
   * Get footer disclosure (end of response)
   */
  getFooter(prediction: QualityPrediction): string {
    const level = this.determineLevel(prediction);
    const emoji = EMOJI[level];

    switch (level) {
      case 'high':
        return `${emoji} High confidence response`;
      case 'medium':
        return `${emoji} Medium confidence - consider verifying critical claims`;
      case 'low':
        return `${emoji} Low confidence - please verify with source code`;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Determine disclosure level based on prediction
   */
  private determineLevel(prediction: QualityPrediction): DisclosureLevel {
    const accuracy = prediction.synthesisAccuracy;

    if (accuracy >= CONFIDENCE_THRESHOLDS.high) {
      return 'high';
    } else if (accuracy >= CONFIDENCE_THRESHOLDS.medium) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Generate summary based on level
   */
  private generateSummary(prediction: QualityPrediction, level: DisclosureLevel): string {
    switch (level) {
      case 'high':
        return HIGH_CONFIDENCE_TEMPLATES.summary(prediction.factors);
      case 'medium':
        return MEDIUM_CONFIDENCE_TEMPLATES.summary;
      case 'low':
        return LOW_CONFIDENCE_TEMPLATES.summary;
    }
  }

  /**
   * Generate details based on factors and level
   */
  private generateDetails(
    prediction: QualityPrediction,
    level: DisclosureLevel,
    config: DisclosureConfig
  ): string[] {
    // High confidence doesn't need details
    if (level === 'high') {
      return [];
    }

    // Get negative factors
    const negativeFactors = prediction.factors.filter((f) => f.impact === 'negative');

    if (negativeFactors.length === 0) {
      return [];
    }

    // Generate detail strings from reasons
    return negativeFactors.map((f) => f.reason);
  }

  /**
   * Generate recommendations based on level
   */
  private generateRecommendations(
    prediction: QualityPrediction,
    level: DisclosureLevel,
    config: DisclosureConfig
  ): string[] {
    // High confidence doesn't need recommendations
    if (level === 'high') {
      return [];
    }

    // Medium confidence gets one recommendation
    if (level === 'medium') {
      return [MEDIUM_CONFIDENCE_TEMPLATES.recommendation];
    }

    // Low confidence gets full recommendations
    return LOW_CONFIDENCE_TEMPLATES.recommendations;
  }

  /**
   * Format disclosure as markdown
   */
  private formatMarkdown(disclosure: QualityDisclosure, config: DisclosureConfig): string {
    const { verbosity, includeFactors, includeRecommendations, formatStyle } = config;

    // Inline style - very short
    if (formatStyle === 'inline') {
      return `(confidence: ${disclosure.level})`;
    }

    // Footer style - moderate length
    if (formatStyle === 'footer') {
      const emoji = EMOJI[disclosure.level];
      let text = `${emoji} ${disclosure.summary}`;

      if (includeRecommendations && disclosure.recommendations.length > 0 && verbosity !== 'minimal') {
        text += ` ${disclosure.recommendations[0]}`;
      }

      return text;
    }

    // Block style - full detail
    const emoji = EMOJI[disclosure.level];
    let text = `${emoji} ${disclosure.summary}`;

    // Add details if configured and available
    if (includeFactors && disclosure.details.length > 0 && verbosity !== 'minimal') {
      text += '\n';
      for (const detail of disclosure.details) {
        text += `- ${detail}\n`;
      }
    }

    // Add recommendations if configured and available
    if (includeRecommendations && disclosure.recommendations.length > 0 && verbosity !== 'minimal') {
      if (disclosure.details.length > 0 || verbosity === 'verbose') {
        text += '\nRecommendations:\n';
        for (const rec of disclosure.recommendations) {
          text += `- ${rec}\n`;
        }
      }
    }

    return text.trim();
  }

  /**
   * Format disclosure as plain text
   */
  private formatPlainText(disclosure: QualityDisclosure, config: DisclosureConfig): string {
    const { verbosity, includeFactors, includeRecommendations, formatStyle } = config;

    // Inline style - very short
    if (formatStyle === 'inline') {
      return `(confidence: ${disclosure.level})`;
    }

    // Footer style - moderate length
    if (formatStyle === 'footer') {
      let text = `[${disclosure.level.toUpperCase()}] ${disclosure.summary}`;

      if (includeRecommendations && disclosure.recommendations.length > 0 && verbosity !== 'minimal') {
        text += ` ${disclosure.recommendations[0]}`;
      }

      return text;
    }

    // Block style - full detail
    let text = `[${disclosure.level.toUpperCase()}] ${disclosure.summary}`;

    // Add details if configured and available
    if (includeFactors && disclosure.details.length > 0 && verbosity !== 'minimal') {
      text += '\n';
      for (const detail of disclosure.details) {
        text += `  - ${detail}\n`;
      }
    }

    // Add recommendations if configured and available
    if (includeRecommendations && disclosure.recommendations.length > 0 && verbosity !== 'minimal') {
      if (disclosure.details.length > 0 || verbosity === 'verbose') {
        text += '\nRecommendations:\n';
        for (const rec of disclosure.recommendations) {
          text += `  - ${rec}\n`;
        }
      }
    }

    return text.trim();
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new QualityDisclosureGenerator instance
 */
export function createQualityDisclosureGenerator(
  config?: Partial<DisclosureConfig>
): QualityDisclosureGenerator {
  return new QualityDisclosureGenerator(config);
}
