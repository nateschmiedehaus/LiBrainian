/**
 * @fileoverview Tests for Quality Disclosure System
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Quality Disclosure system ensures Librarian's responses include honest
 * quality disclosures. This is the user-facing component that communicates uncertainty.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  QualityDisclosureGenerator,
  createQualityDisclosureGenerator,
  type QualityDisclosure,
  type DisclosureConfig,
  type FormattedDisclosure,
  DEFAULT_DISCLOSURE_CONFIG,
} from '../quality_disclosure.js';
import {
  createQualityPredictionModel,
  type QualityPrediction,
} from '../quality_prediction.js';
import {
  createCodebaseProfiler,
  type CodebaseProfile,
} from '../codebase_profiler.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as the main test fixture
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

/**
 * Create a high-quality prediction
 */
function createHighQualityPrediction(): QualityPrediction {
  return {
    retrievalAccuracy: 0.85,
    synthesisAccuracy: 0.82,
    hallucinationRisk: 0.15,
    confidenceInterval: { low: 0.78, high: 0.92 },
    factors: [
      { name: 'TypeScript', impact: 'positive', weight: 0.8, reason: 'Type information helps understand code structure' },
      { name: 'Tests Present', impact: 'positive', weight: 0.7, reason: 'Tests provide behavioral documentation' },
      { name: 'Small Size', impact: 'positive', weight: 0.6, reason: 'Small codebase is easier to index' },
    ],
  };
}

/**
 * Create a medium-quality prediction
 */
function createMediumQualityPrediction(): QualityPrediction {
  return {
    retrievalAccuracy: 0.65,
    synthesisAccuracy: 0.60,
    hallucinationRisk: 0.35,
    confidenceInterval: { low: 0.55, high: 0.75 },
    factors: [
      { name: 'Medium Size', impact: 'positive', weight: 0.4, reason: 'Manageable codebase size' },
      { name: 'No TypeScript', impact: 'negative', weight: 0.6, reason: 'Missing type information' },
      { name: 'Poor Documentation', impact: 'negative', weight: 0.5, reason: 'Lack of documentation' },
    ],
  };
}

/**
 * Create a low-quality prediction
 */
function createLowQualityPrediction(): QualityPrediction {
  return {
    retrievalAccuracy: 0.45,
    synthesisAccuracy: 0.40,
    hallucinationRisk: 0.55,
    confidenceInterval: { low: 0.35, high: 0.55 },
    factors: [
      { name: 'Large Size', impact: 'negative', weight: 0.7, reason: 'Large codebase with complex dependencies' },
      { name: 'No TypeScript', impact: 'negative', weight: 0.6, reason: 'Missing type information' },
      { name: 'Poor Documentation', impact: 'negative', weight: 0.5, reason: 'Lack of documentation' },
      { name: 'Complex Functions', impact: 'negative', weight: 0.5, reason: 'Many complex functions' },
    ],
  };
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createQualityDisclosureGenerator', () => {
  it('should create a generator instance', () => {
    const generator = createQualityDisclosureGenerator();
    expect(generator).toBeInstanceOf(QualityDisclosureGenerator);
  });

  it('should create a generator with custom config', () => {
    const customConfig: Partial<DisclosureConfig> = {
      verbosity: 'verbose',
      includeFactors: true,
      includeRecommendations: true,
      formatStyle: 'block',
    };

    const generator = createQualityDisclosureGenerator(customConfig);
    expect(generator).toBeInstanceOf(QualityDisclosureGenerator);
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe('Default Disclosure Configuration', () => {
  it('should have valid default config', () => {
    expect(DEFAULT_DISCLOSURE_CONFIG).toBeDefined();
    expect(['minimal', 'standard', 'verbose']).toContain(DEFAULT_DISCLOSURE_CONFIG.verbosity);
    expect(typeof DEFAULT_DISCLOSURE_CONFIG.includeFactors).toBe('boolean');
    expect(typeof DEFAULT_DISCLOSURE_CONFIG.includeRecommendations).toBe('boolean');
    expect(['inline', 'block', 'footer']).toContain(DEFAULT_DISCLOSURE_CONFIG.formatStyle);
  });

  it('should have standard verbosity as default', () => {
    expect(DEFAULT_DISCLOSURE_CONFIG.verbosity).toBe('standard');
  });
});

// ============================================================================
// DISCLOSURE STRUCTURE TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Disclosure Structure', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate a complete QualityDisclosure', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure).toBeDefined();
    expect(['high', 'medium', 'low']).toContain(disclosure.level);
    expect(typeof disclosure.summary).toBe('string');
    expect(Array.isArray(disclosure.details)).toBe(true);
    expect(typeof disclosure.confidence).toBe('number');
    expect(Array.isArray(disclosure.recommendations)).toBe(true);
  });

  it('should have confidence between 0 and 1', () => {
    const predictions = [
      createHighQualityPrediction(),
      createMediumQualityPrediction(),
      createLowQualityPrediction(),
    ];

    for (const prediction of predictions) {
      const disclosure = generator.generate(prediction);
      expect(disclosure.confidence).toBeGreaterThanOrEqual(0);
      expect(disclosure.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should include a non-empty summary', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.summary.length).toBeGreaterThan(0);
  });

  it('should include details for medium/low confidence', () => {
    const mediumPrediction = createMediumQualityPrediction();
    const lowPrediction = createLowQualityPrediction();

    const mediumDisclosure = generator.generate(mediumPrediction);
    const lowDisclosure = generator.generate(lowPrediction);

    expect(mediumDisclosure.details.length).toBeGreaterThan(0);
    expect(lowDisclosure.details.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// LEVEL DETERMINATION TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Level Determination', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should determine high level for high-quality predictions', () => {
    const prediction = createHighQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.level).toBe('high');
  });

  it('should determine medium level for medium-quality predictions', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.level).toBe('medium');
  });

  it('should determine low level for low-quality predictions', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.level).toBe('low');
  });

  it('should handle boundary cases', () => {
    // Exactly at high threshold
    const boundaryHighPrediction: QualityPrediction = {
      ...createHighQualityPrediction(),
      synthesisAccuracy: 0.75,
    };

    // Exactly at medium threshold
    const boundaryMediumPrediction: QualityPrediction = {
      ...createMediumQualityPrediction(),
      synthesisAccuracy: 0.5,
    };

    const highDisclosure = generator.generate(boundaryHighPrediction);
    const mediumDisclosure = generator.generate(boundaryMediumPrediction);

    expect(['high', 'medium']).toContain(highDisclosure.level);
    expect(['medium', 'low']).toContain(mediumDisclosure.level);
  });
});

// ============================================================================
// SUMMARY GENERATION TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Summary Generation', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate positive summary for high confidence', () => {
    const prediction = createHighQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.summary.toLowerCase()).toMatch(/high|confident|accurate|typed|tests/);
  });

  it('should generate cautious summary for medium confidence', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.summary.toLowerCase()).toMatch(/medium|some|may|affect|factors/);
  });

  it('should generate warning summary for low confidence', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.summary.toLowerCase()).toMatch(/low|verify|please|caution/);
  });
});

// ============================================================================
// DETAILS GENERATION TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Details Generation', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate details based on negative factors', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    // Should include details about the negative factors
    expect(disclosure.details.length).toBeGreaterThan(0);

    const detailsText = disclosure.details.join(' ').toLowerCase();
    // Should mention at least one negative factor
    expect(
      detailsText.includes('type') ||
      detailsText.includes('documentation') ||
      detailsText.includes('size') ||
      detailsText.includes('complex')
    ).toBe(true);
  });

  it('should have fewer details for high confidence', () => {
    const highPrediction = createHighQualityPrediction();
    const lowPrediction = createLowQualityPrediction();

    const highDisclosure = generator.generate(highPrediction);
    const lowDisclosure = generator.generate(lowPrediction);

    // High confidence should have fewer or no details
    expect(highDisclosure.details.length).toBeLessThanOrEqual(lowDisclosure.details.length);
  });

  it('should include all negative factors in details', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    const negativeFactors = prediction.factors.filter(f => f.impact === 'negative');
    // Should have at least one detail per negative factor (or aggregated)
    expect(disclosure.details.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// RECOMMENDATIONS GENERATION TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Recommendations Generation', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate no recommendations for high confidence', () => {
    const prediction = createHighQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.recommendations.length).toBe(0);
  });

  it('should generate some recommendations for medium confidence', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.recommendations.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate multiple recommendations for low confidence', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    expect(disclosure.recommendations.length).toBeGreaterThanOrEqual(2);
  });

  it('should include actionable recommendations', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    const recsText = disclosure.recommendations.join(' ').toLowerCase();
    // Should include actionable verbs
    expect(
      recsText.includes('verify') ||
      recsText.includes('check') ||
      recsText.includes('cross-reference') ||
      recsText.includes('confirm') ||
      recsText.includes('review')
    ).toBe(true);
  });
});

// ============================================================================
// FORMAT TESTS - INLINE
// ============================================================================

describe('QualityDisclosureGenerator - Inline Format', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate short inline disclosure', () => {
    const prediction = createMediumQualityPrediction();
    const inline = generator.getInline(prediction);

    expect(typeof inline).toBe('string');
    expect(inline.length).toBeLessThan(100); // Should be short
  });

  it('should include confidence level in inline', () => {
    const prediction = createMediumQualityPrediction();
    const inline = generator.getInline(prediction);

    expect(inline.toLowerCase()).toMatch(/confidence|medium/);
  });

  it('should be parenthetical format', () => {
    const prediction = createHighQualityPrediction();
    const inline = generator.getInline(prediction);

    expect(inline).toMatch(/^\(.*\)$/);
  });

  it('should vary by confidence level', () => {
    const highInline = generator.getInline(createHighQualityPrediction());
    const lowInline = generator.getInline(createLowQualityPrediction());

    // Should be different for different confidence levels
    expect(highInline).not.toBe(lowInline);
  });
});

// ============================================================================
// FORMAT TESTS - BLOCK
// ============================================================================

describe('QualityDisclosureGenerator - Block Format', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate detailed block disclosure', () => {
    const prediction = createMediumQualityPrediction();
    const block = generator.getBlock(prediction);

    expect(typeof block).toBe('string');
    expect(block.length).toBeGreaterThan(50); // Should be detailed
  });

  it('should include markdown formatting', () => {
    const prediction = createLowQualityPrediction();
    const block = generator.getBlock(prediction);

    // Should include some markdown elements
    expect(
      block.includes('-') ||  // List items
      block.includes('*') ||  // Bold/italic
      block.includes('#') ||  // Headers
      block.includes('\n')    // Newlines
    ).toBe(true);
  });

  it('should include factors for low confidence', () => {
    const prediction = createLowQualityPrediction();
    const block = generator.getBlock(prediction);

    // Should list the negative factors
    expect(block.toLowerCase()).toMatch(/type|documentation|size|complex/);
  });

  it('should include recommendations for low confidence', () => {
    const prediction = createLowQualityPrediction();
    const block = generator.getBlock(prediction);

    expect(block.toLowerCase()).toMatch(/verify|check|recommend|cross-reference|source/);
  });
});

// ============================================================================
// FORMAT TESTS - FOOTER
// ============================================================================

describe('QualityDisclosureGenerator - Footer Format', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate footer disclosure', () => {
    const prediction = createMediumQualityPrediction();
    const footer = generator.getFooter(prediction);

    expect(typeof footer).toBe('string');
    expect(footer.length).toBeGreaterThan(0);
  });

  it('should be suitable for end of response', () => {
    const prediction = createLowQualityPrediction();
    const footer = generator.getFooter(prediction);

    // Footer should be a summary appropriate for end of response
    expect(footer).toBeDefined();
    expect(footer.length).toBeGreaterThan(10);
  });

  it('should include emoji indicator for warning levels', () => {
    const lowPrediction = createLowQualityPrediction();
    const mediumPrediction = createMediumQualityPrediction();

    const lowFooter = generator.getFooter(lowPrediction);
    const mediumFooter = generator.getFooter(mediumPrediction);

    // Should use warning/check emojis
    expect(lowFooter.match(/[^\x00-\x7F]/) || lowFooter.includes('!')).toBeTruthy();
    expect(mediumFooter.match(/[^\x00-\x7F]/) || mediumFooter.includes('!')).toBeTruthy();
  });

  it('should be shorter than block format', () => {
    const prediction = createLowQualityPrediction();
    const block = generator.getBlock(prediction);
    const footer = generator.getFooter(prediction);

    expect(footer.length).toBeLessThan(block.length);
  });
});

// ============================================================================
// FORMAT METHOD TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Format Method', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should format disclosure to FormattedDisclosure', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);
    const formatted = generator.format(disclosure);

    expect(formatted).toBeDefined();
    expect(typeof formatted.markdown).toBe('string');
    expect(typeof formatted.plainText).toBe('string');
    expect(formatted.structured).toBe(disclosure);
  });

  it('should produce valid markdown', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);
    const formatted = generator.format(disclosure);

    expect(formatted.markdown.length).toBeGreaterThan(0);
    // Markdown should include some formatting
    expect(
      formatted.markdown.includes('-') ||
      formatted.markdown.includes('*') ||
      formatted.markdown.includes('#') ||
      formatted.markdown.includes('\n')
    ).toBe(true);
  });

  it('should produce valid plain text', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);
    const formatted = generator.format(disclosure);

    expect(formatted.plainText.length).toBeGreaterThan(0);
    // Plain text should not have excessive markdown
    expect(formatted.plainText).not.toMatch(/#{2,}/); // No multiple # headers
  });

  it('should respect config verbosity', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    const minimalConfig: DisclosureConfig = {
      verbosity: 'minimal',
      includeFactors: false,
      includeRecommendations: false,
      formatStyle: 'inline',
    };

    const verboseConfig: DisclosureConfig = {
      verbosity: 'verbose',
      includeFactors: true,
      includeRecommendations: true,
      formatStyle: 'block',
    };

    const minimalFormatted = generator.format(disclosure, minimalConfig);
    const verboseFormatted = generator.format(disclosure, verboseConfig);

    expect(minimalFormatted.markdown.length).toBeLessThan(verboseFormatted.markdown.length);
  });

  it('should include factors when configured', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    const withFactors = generator.format(disclosure, {
      verbosity: 'verbose',
      includeFactors: true,
      includeRecommendations: false,
      formatStyle: 'block',
    });

    const withoutFactors = generator.format(disclosure, {
      verbosity: 'verbose',
      includeFactors: false,
      includeRecommendations: false,
      formatStyle: 'block',
    });

    expect(withFactors.markdown.length).toBeGreaterThan(withoutFactors.markdown.length);
  });

  it('should include recommendations when configured', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    const withRecs = generator.format(disclosure, {
      verbosity: 'verbose',
      includeFactors: false,
      includeRecommendations: true,
      formatStyle: 'block',
    });

    const withoutRecs = generator.format(disclosure, {
      verbosity: 'verbose',
      includeFactors: false,
      includeRecommendations: false,
      formatStyle: 'block',
    });

    expect(withRecs.markdown.length).toBeGreaterThan(withoutRecs.markdown.length);
  });
});

// ============================================================================
// FORMAT STYLE TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Format Styles', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should format inline style', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    const formatted = generator.format(disclosure, {
      verbosity: 'standard',
      includeFactors: false,
      includeRecommendations: false,
      formatStyle: 'inline',
    });

    // Inline should be short
    expect(formatted.markdown.length).toBeLessThan(100);
  });

  it('should format block style', () => {
    const prediction = createLowQualityPrediction();
    const disclosure = generator.generate(prediction);

    const formatted = generator.format(disclosure, {
      verbosity: 'verbose',
      includeFactors: true,
      includeRecommendations: true,
      formatStyle: 'block',
    });

    // Block should be detailed with newlines
    expect(formatted.markdown).toContain('\n');
    expect(formatted.markdown.length).toBeGreaterThan(100);
  });

  it('should format footer style', () => {
    const prediction = createMediumQualityPrediction();
    const disclosure = generator.generate(prediction);

    const formatted = generator.format(disclosure, {
      verbosity: 'standard',
      includeFactors: false,
      includeRecommendations: true,
      formatStyle: 'footer',
    });

    // Footer should be medium length
    expect(formatted.markdown.length).toBeGreaterThan(20);
    expect(formatted.markdown.length).toBeLessThan(500);
  });
});

// ============================================================================
// TEMPLATE TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Templates', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should generate high confidence template correctly', () => {
    const prediction = createHighQualityPrediction();
    const block = generator.getBlock(prediction);

    // Should match expected template pattern for high confidence
    expect(block).toMatch(/[^\x00-\x7F].*[Hh]igh.*confidence/i);
    expect(block.toLowerCase()).toMatch(/typed|tests|well/);
  });

  it('should generate medium confidence template correctly', () => {
    const prediction = createMediumQualityPrediction();
    const block = generator.getBlock(prediction);

    // Should match expected template pattern for medium confidence
    expect(block).toMatch(/[^\x00-\x7F].*[Mm]edium.*confidence/i);
    expect(block.toLowerCase()).toMatch(/some.*factors|may.*affect|consider/);
  });

  it('should generate low confidence template correctly', () => {
    const prediction = createLowQualityPrediction();
    const block = generator.getBlock(prediction);

    // Should match expected template pattern for low confidence
    expect(block).toMatch(/[^\x00-\x7F].*[Ll]ow.*confidence/i);
    expect(block.toLowerCase()).toMatch(/verify|missing|large|complex/);
    expect(block.toLowerCase()).toMatch(/recommend/);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Integration', () => {
  let generator: QualityDisclosureGenerator;
  let predictionModel: ReturnType<typeof createQualityPredictionModel>;
  let profiler: ReturnType<typeof createCodebaseProfiler>;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
    predictionModel = createQualityPredictionModel();
    profiler = createCodebaseProfiler();
  });

  it('should work with real profile from Librarian repo', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);
    const prediction = predictionModel.predict(profile);
    const disclosure = generator.generate(prediction);

    expect(disclosure).toBeDefined();
    expect(['high', 'medium', 'low']).toContain(disclosure.level);
    expect(disclosure.summary.length).toBeGreaterThan(0);
  });

  it('should produce appropriate disclosure for high-quality repo', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);
    const prediction = predictionModel.predict(profile);
    const disclosure = generator.generate(prediction);

    // Librarian is a high-quality TypeScript project
    expect(disclosure.level).toBe('high');
    expect(disclosure.recommendations.length).toBe(0);
  });

  it('should generate all format types for real prediction', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);
    const prediction = predictionModel.predict(profile);

    const inline = generator.getInline(prediction);
    const block = generator.getBlock(prediction);
    const footer = generator.getFooter(prediction);

    expect(inline.length).toBeGreaterThan(0);
    expect(block.length).toBeGreaterThan(0);
    expect(footer.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('QualityDisclosureGenerator - Edge Cases', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should handle prediction with empty factors', () => {
    const prediction: QualityPrediction = {
      retrievalAccuracy: 0.5,
      synthesisAccuracy: 0.5,
      hallucinationRisk: 0.5,
      confidenceInterval: { low: 0.4, high: 0.6 },
      factors: [],
    };

    const disclosure = generator.generate(prediction);

    expect(disclosure).toBeDefined();
    expect(['high', 'medium', 'low']).toContain(disclosure.level);
  });

  it('should handle prediction with extreme values', () => {
    const extremeHigh: QualityPrediction = {
      retrievalAccuracy: 1.0,
      synthesisAccuracy: 1.0,
      hallucinationRisk: 0.0,
      confidenceInterval: { low: 0.95, high: 1.0 },
      factors: [],
    };

    const extremeLow: QualityPrediction = {
      retrievalAccuracy: 0.0,
      synthesisAccuracy: 0.0,
      hallucinationRisk: 1.0,
      confidenceInterval: { low: 0.0, high: 0.1 },
      factors: [],
    };

    const highDisclosure = generator.generate(extremeHigh);
    const lowDisclosure = generator.generate(extremeLow);

    expect(highDisclosure.level).toBe('high');
    expect(lowDisclosure.level).toBe('low');
  });

  it('should handle all negative factors', () => {
    const allNegative: QualityPrediction = {
      retrievalAccuracy: 0.4,
      synthesisAccuracy: 0.35,
      hallucinationRisk: 0.6,
      confidenceInterval: { low: 0.25, high: 0.45 },
      factors: [
        { name: 'Factor1', impact: 'negative', weight: 0.5, reason: 'Reason1' },
        { name: 'Factor2', impact: 'negative', weight: 0.5, reason: 'Reason2' },
        { name: 'Factor3', impact: 'negative', weight: 0.5, reason: 'Reason3' },
      ],
    };

    const disclosure = generator.generate(allNegative);

    expect(disclosure.level).toBe('low');
    expect(disclosure.details.length).toBeGreaterThan(0);
    expect(disclosure.recommendations.length).toBeGreaterThan(0);
  });

  it('should handle all positive factors', () => {
    const allPositive: QualityPrediction = {
      retrievalAccuracy: 0.9,
      synthesisAccuracy: 0.88,
      hallucinationRisk: 0.1,
      confidenceInterval: { low: 0.85, high: 0.95 },
      factors: [
        { name: 'Factor1', impact: 'positive', weight: 0.8, reason: 'Reason1' },
        { name: 'Factor2', impact: 'positive', weight: 0.7, reason: 'Reason2' },
        { name: 'Factor3', impact: 'positive', weight: 0.6, reason: 'Reason3' },
      ],
    };

    const disclosure = generator.generate(allPositive);

    expect(disclosure.level).toBe('high');
    expect(disclosure.recommendations.length).toBe(0);
  });
});

// ============================================================================
// CONSISTENCY TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Consistency', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should produce consistent disclosures', () => {
    const prediction = createMediumQualityPrediction();

    const disclosure1 = generator.generate(prediction);
    const disclosure2 = generator.generate(prediction);

    expect(disclosure1.level).toBe(disclosure2.level);
    expect(disclosure1.summary).toBe(disclosure2.summary);
    expect(disclosure1.confidence).toBe(disclosure2.confidence);
    expect(disclosure1.details.length).toBe(disclosure2.details.length);
    expect(disclosure1.recommendations.length).toBe(disclosure2.recommendations.length);
  });

  it('should produce consistent formatted output', () => {
    const prediction = createLowQualityPrediction();

    const inline1 = generator.getInline(prediction);
    const inline2 = generator.getInline(prediction);

    const block1 = generator.getBlock(prediction);
    const block2 = generator.getBlock(prediction);

    expect(inline1).toBe(inline2);
    expect(block1).toBe(block2);
  });
});

// ============================================================================
// CONFIDENCE MAPPING TESTS
// ============================================================================

describe('QualityDisclosureGenerator - Confidence Mapping', () => {
  let generator: QualityDisclosureGenerator;

  beforeAll(() => {
    generator = createQualityDisclosureGenerator();
  });

  it('should map synthesis accuracy to confidence', () => {
    const predictions = [
      createHighQualityPrediction(),
      createMediumQualityPrediction(),
      createLowQualityPrediction(),
    ];

    for (const prediction of predictions) {
      const disclosure = generator.generate(prediction);
      // Confidence should be based on synthesis accuracy
      expect(Math.abs(disclosure.confidence - prediction.synthesisAccuracy)).toBeLessThan(0.2);
    }
  });

  it('should reflect hallucination risk in disclosure', () => {
    const highRisk: QualityPrediction = {
      ...createLowQualityPrediction(),
      hallucinationRisk: 0.7,
    };

    const lowRisk: QualityPrediction = {
      ...createHighQualityPrediction(),
      hallucinationRisk: 0.1,
    };

    const highRiskDisclosure = generator.generate(highRisk);
    const lowRiskDisclosure = generator.generate(lowRisk);

    // High risk should result in more warnings
    expect(highRiskDisclosure.level).toBe('low');
    expect(lowRiskDisclosure.level).toBe('high');
  });
});
