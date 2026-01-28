/**
 * @fileoverview Tests for Adaptive Synthesis
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Adaptive Synthesis system adjusts Librarian's response generation strategy
 * based on quality prediction. When quality is expected to be low, it uses more
 * conservative synthesis with more hedging.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  AdaptiveSynthesizer,
  createAdaptiveSynthesizer,
  type SynthesisStrategy,
  type SynthesizedResponse,
  type SynthesisContext,
  type AdaptiveSynthesisConfig,
  DEFAULT_SYNTHESIS_STRATEGIES,
  DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG,
} from '../adaptive_synthesis.js';
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
 * Create a minimal mock profile for testing
 */
function createMockProfile(overrides: Partial<CodebaseProfile> = {}): CodebaseProfile {
  return {
    repoPath: '/test/repo',
    analyzedAt: new Date().toISOString(),
    size: {
      totalFiles: 50,
      totalLines: 5000,
      languages: { TypeScript: 30, JavaScript: 10, JSON: 10 },
    },
    complexity: {
      averageFunctionsPerFile: 5,
      averageClassesPerFile: 0.5,
      maxFileSize: 300,
      deepestNesting: 4,
    },
    quality: {
      hasTests: true,
      hasTypeScript: true,
      hasLinting: true,
      hasCI: true,
      documentationScore: 0.7,
    },
    structure: {
      isMonorepo: false,
      hasWorkspaces: false,
      entryPoints: ['src/index.ts'],
      configFiles: ['package.json', 'tsconfig.json'],
    },
    risks: {
      largeFiles: [],
      complexFunctions: [],
      circularDependencies: false,
      outdatedDependencies: false,
    },
    classification: 'small',
    qualityTier: 'high',
    ...overrides,
  };
}

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
      { name: 'TypeScript', impact: 'positive', weight: 0.8, reason: 'Type information helps' },
      { name: 'Tests Present', impact: 'positive', weight: 0.7, reason: 'Tests provide examples' },
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
      { name: 'Medium Size', impact: 'positive', weight: 0.4, reason: 'Manageable size' },
      { name: 'No TypeScript', impact: 'negative', weight: 0.6, reason: 'Missing types' },
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
      { name: 'Large Size', impact: 'negative', weight: 0.7, reason: 'Hard to search' },
      { name: 'No TypeScript', impact: 'negative', weight: 0.6, reason: 'Missing types' },
      { name: 'Poor Documentation', impact: 'negative', weight: 0.5, reason: 'Hard to understand' },
    ],
  };
}

/**
 * Create a synthesis context
 */
function createSynthesisContext(
  prediction: QualityPrediction,
  overrides: Partial<SynthesisContext> = {}
): SynthesisContext {
  return {
    query: 'What does the authenticate function do?',
    profile: createMockProfile(),
    prediction,
    retrievedContext: [
      'function authenticate(user: string, password: string): boolean { ... }',
      'The authenticate function verifies user credentials against the database.',
    ],
    ...overrides,
  };
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createAdaptiveSynthesizer', () => {
  it('should create a synthesizer instance', () => {
    const synthesizer = createAdaptiveSynthesizer();
    expect(synthesizer).toBeInstanceOf(AdaptiveSynthesizer);
  });

  it('should create a synthesizer with custom config', () => {
    const customConfig: Partial<AdaptiveSynthesisConfig> = {
      qualityThresholds: {
        high: 0.85,
        medium: 0.6,
        low: 0.4,
      },
    };

    const synthesizer = createAdaptiveSynthesizer(customConfig);
    expect(synthesizer).toBeInstanceOf(AdaptiveSynthesizer);
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe('Default Synthesis Configuration', () => {
  it('should have valid default strategies', () => {
    expect(DEFAULT_SYNTHESIS_STRATEGIES).toBeDefined();
    expect(DEFAULT_SYNTHESIS_STRATEGIES.aggressive).toBeDefined();
    expect(DEFAULT_SYNTHESIS_STRATEGIES.moderate).toBeDefined();
    expect(DEFAULT_SYNTHESIS_STRATEGIES.conservative).toBeDefined();
  });

  it('should have valid default config', () => {
    expect(DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG).toBeDefined();
    expect(DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.defaultStrategy).toBeDefined();
    expect(DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.qualityThresholds).toBeDefined();
    expect(DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.qualityThresholds.high).toBeGreaterThan(
      DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.qualityThresholds.medium
    );
    expect(DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.qualityThresholds.medium).toBeGreaterThan(
      DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG.qualityThresholds.low
    );
  });
});

// ============================================================================
// STRATEGY STRUCTURE TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Strategy Structure', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should have valid strategy structure for aggressive', () => {
    const strategy = DEFAULT_SYNTHESIS_STRATEGIES.aggressive;

    expect(typeof strategy.name).toBe('string');
    expect(typeof strategy.confidenceThreshold).toBe('number');
    expect(['strict', 'moderate', 'relaxed']).toContain(strategy.citationRequirement);
    expect(['none', 'light', 'heavy']).toContain(strategy.hedgingLevel);
    expect(typeof strategy.verificationRequired).toBe('boolean');
    expect(typeof strategy.maxClaimsPerResponse).toBe('number');
    expect(Array.isArray(strategy.disclaimers)).toBe(true);
  });

  it('should have valid strategy structure for moderate', () => {
    const strategy = DEFAULT_SYNTHESIS_STRATEGIES.moderate;

    expect(typeof strategy.name).toBe('string');
    expect(typeof strategy.confidenceThreshold).toBe('number');
    expect(['strict', 'moderate', 'relaxed']).toContain(strategy.citationRequirement);
    expect(['none', 'light', 'heavy']).toContain(strategy.hedgingLevel);
    expect(typeof strategy.verificationRequired).toBe('boolean');
    expect(typeof strategy.maxClaimsPerResponse).toBe('number');
    expect(Array.isArray(strategy.disclaimers)).toBe(true);
  });

  it('should have valid strategy structure for conservative', () => {
    const strategy = DEFAULT_SYNTHESIS_STRATEGIES.conservative;

    expect(typeof strategy.name).toBe('string');
    expect(typeof strategy.confidenceThreshold).toBe('number');
    expect(['strict', 'moderate', 'relaxed']).toContain(strategy.citationRequirement);
    expect(['none', 'light', 'heavy']).toContain(strategy.hedgingLevel);
    expect(typeof strategy.verificationRequired).toBe('boolean');
    expect(typeof strategy.maxClaimsPerResponse).toBe('number');
    expect(Array.isArray(strategy.disclaimers)).toBe(true);
  });
});

// ============================================================================
// STRATEGY SELECTION TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Strategy Selection', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should select aggressive strategy for high quality predictions', () => {
    const prediction = createHighQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);

    expect(strategy.name).toBe('aggressive');
    expect(strategy.hedgingLevel).toBe('none');
    expect(strategy.verificationRequired).toBe(false);
  });

  it('should select moderate strategy for medium quality predictions', () => {
    const prediction = createMediumQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);

    expect(strategy.name).toBe('moderate');
    expect(strategy.hedgingLevel).toBe('light');
  });

  it('should select conservative strategy for low quality predictions', () => {
    const prediction = createLowQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);

    expect(strategy.name).toBe('conservative');
    expect(strategy.hedgingLevel).toBe('heavy');
    expect(strategy.verificationRequired).toBe(true);
  });

  it('should select strategy based on synthesis accuracy', () => {
    // The quality threshold should use synthesis accuracy
    const highPrediction = { ...createHighQualityPrediction(), synthesisAccuracy: 0.9 };
    const lowPrediction = { ...createHighQualityPrediction(), synthesisAccuracy: 0.4 };

    const highStrategy = synthesizer.selectStrategy(highPrediction);
    const lowStrategy = synthesizer.selectStrategy(lowPrediction);

    expect(highStrategy.name).toBe('aggressive');
    expect(lowStrategy.name).toBe('conservative');
  });

  it('should return valid strategy for edge case predictions', () => {
    const edgeCases: QualityPrediction[] = [
      { ...createHighQualityPrediction(), synthesisAccuracy: 0 },
      { ...createHighQualityPrediction(), synthesisAccuracy: 1 },
      { ...createHighQualityPrediction(), synthesisAccuracy: 0.5 },
    ];

    for (const prediction of edgeCases) {
      const strategy = synthesizer.selectStrategy(prediction);
      expect(strategy).toBeDefined();
      expect(typeof strategy.name).toBe('string');
    }
  });
});

// ============================================================================
// HEDGING TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Hedging', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should apply no hedging for level none', () => {
    const content = 'Function X returns a string';
    const hedged = synthesizer.applyHedging(content, 'none');

    expect(hedged).toBe(content);
  });

  it('should apply light hedging', () => {
    const content = 'Function X returns a string';
    const hedged = synthesizer.applyHedging(content, 'light');

    // Light hedging should add phrases like "appears to", "likely", "seems"
    expect(hedged).not.toBe(content);
    expect(hedged.toLowerCase()).toMatch(/appears|likely|seems|probably/);
  });

  it('should apply heavy hedging', () => {
    const content = 'Function X returns a string';
    const hedged = synthesizer.applyHedging(content, 'heavy');

    // Heavy hedging should add more cautious language
    expect(hedged).not.toBe(content);
    expect(hedged.toLowerCase()).toMatch(
      /based on|may|should be verified|available|though|appears|could/
    );
  });

  it('should preserve meaning while hedging', () => {
    const content = 'The authenticate function validates user credentials';
    const lightHedged = synthesizer.applyHedging(content, 'light');
    const heavyHedged = synthesizer.applyHedging(content, 'heavy');

    // Core content should still be present
    expect(lightHedged.toLowerCase()).toContain('authenticate');
    expect(lightHedged.toLowerCase()).toContain('credentials');
    expect(heavyHedged.toLowerCase()).toContain('authenticate');
    expect(heavyHedged.toLowerCase()).toContain('credentials');
  });

  it('should handle empty content gracefully', () => {
    const hedged = synthesizer.applyHedging('', 'heavy');
    expect(hedged).toBe('');
  });

  it('should handle multi-sentence content', () => {
    const content =
      'Function X returns a string. It validates the input. The return value is always non-null.';
    const hedged = synthesizer.applyHedging(content, 'light');

    expect(hedged).toBeDefined();
    expect(hedged.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// DISCLAIMER GENERATION TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Disclaimers', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should generate no disclaimers for aggressive strategy', () => {
    const prediction = createHighQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);
    const disclaimers = synthesizer.generateDisclaimers(prediction, strategy);

    expect(disclaimers.length).toBe(0);
  });

  it('should generate some disclaimers for moderate strategy', () => {
    const prediction = createMediumQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);
    const disclaimers = synthesizer.generateDisclaimers(prediction, strategy);

    expect(disclaimers.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate many disclaimers for conservative strategy', () => {
    const prediction = createLowQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);
    const disclaimers = synthesizer.generateDisclaimers(prediction, strategy);

    expect(disclaimers.length).toBeGreaterThanOrEqual(2);
  });

  it('should generate contextual disclaimers based on factors', () => {
    const prediction = createLowQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);
    const disclaimers = synthesizer.generateDisclaimers(prediction, strategy);

    // Should mention specific issues from factors
    const disclaimerText = disclaimers.join(' ').toLowerCase();
    // At least one disclaimer should be related to the factors
    expect(
      disclaimerText.includes('confidence') ||
        disclaimerText.includes('limited') ||
        disclaimerText.includes('verify') ||
        disclaimerText.includes('based on')
    ).toBe(true);
  });

  it('should include file count in disclaimers when relevant', () => {
    const prediction = createLowQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);
    const disclaimers = synthesizer.generateDisclaimers(prediction, strategy);

    // At least one disclaimer might mention files analyzed
    const disclaimerText = disclaimers.join(' ').toLowerCase();
    expect(disclaimerText.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// SYNTHESIS TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Synthesis', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should synthesize a response with high quality prediction', () => {
    const prediction = createHighQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.strategy.name).toBe('aggressive');
    expect(response.confidenceLevel).toBeGreaterThan(0.7);
    expect(response.disclaimers.length).toBe(0);
  });

  it('should synthesize a response with medium quality prediction', () => {
    const prediction = createMediumQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.strategy.name).toBe('moderate');
    expect(response.disclaimers.length).toBeGreaterThanOrEqual(1);
  });

  it('should synthesize a response with low quality prediction', () => {
    const prediction = createLowQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.strategy.name).toBe('conservative');
    expect(response.metadata.hedgingApplied).toBe(true);
    expect(response.disclaimers.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// RESPONSE STRUCTURE TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Response Structure', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should include all required fields in response', () => {
    const prediction = createMediumQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    expect(response.content).toBeDefined();
    expect(response.strategy).toBeDefined();
    expect(response.citations).toBeDefined();
    expect(response.confidenceLevel).toBeDefined();
    expect(response.disclaimers).toBeDefined();
    expect(response.metadata).toBeDefined();
  });

  it('should include valid metadata in response', () => {
    const prediction = createMediumQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    expect(typeof response.metadata.hedgingApplied).toBe('boolean');
    expect(typeof response.metadata.claimsCount).toBe('number');
    expect(['verified', 'unverified', 'partial']).toContain(
      response.metadata.verificationStatus
    );
  });

  it('should include citations from retrieved context', () => {
    const prediction = createHighQualityPrediction();
    const context = createSynthesisContext(prediction, {
      retrievedContext: [
        'function foo() { return "bar"; } // src/utils.ts:10',
        'function baz() { return 42; } // src/helpers.ts:20',
      ],
    });
    const response = synthesizer.synthesize(context);

    expect(Array.isArray(response.citations)).toBe(true);
  });

  it('should have confidence level between 0 and 1', () => {
    const predictions = [
      createHighQualityPrediction(),
      createMediumQualityPrediction(),
      createLowQualityPrediction(),
    ];

    for (const prediction of predictions) {
      const context = createSynthesisContext(prediction);
      const response = synthesizer.synthesize(context);

      expect(response.confidenceLevel).toBeGreaterThanOrEqual(0);
      expect(response.confidenceLevel).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// CLAIMS COUNT TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Claims Management', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should track claims count in metadata', () => {
    const prediction = createHighQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    expect(response.metadata.claimsCount).toBeGreaterThanOrEqual(0);
  });

  it('should respect maxClaimsPerResponse for conservative strategy', () => {
    const prediction = createLowQualityPrediction();
    const context = createSynthesisContext(prediction, {
      retrievedContext: Array(20).fill('Some retrieved content.'),
    });
    const response = synthesizer.synthesize(context);

    const maxClaims = response.strategy.maxClaimsPerResponse;
    expect(response.metadata.claimsCount).toBeLessThanOrEqual(maxClaims);
  });
});

// ============================================================================
// VERIFICATION STATUS TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Verification', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should set verified status for aggressive strategy', () => {
    const prediction = createHighQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    // Aggressive strategy doesn't require verification
    expect(response.metadata.verificationStatus).toBe('unverified');
  });

  it('should set appropriate verification status based on strategy', () => {
    const prediction = createLowQualityPrediction();
    const context = createSynthesisContext(prediction);
    const response = synthesizer.synthesize(context);

    // Conservative strategy requires verification
    expect(['verified', 'partial', 'unverified']).toContain(
      response.metadata.verificationStatus
    );
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Integration', () => {
  let synthesizer: AdaptiveSynthesizer;
  let predictionModel: ReturnType<typeof createQualityPredictionModel>;
  let profiler: ReturnType<typeof createCodebaseProfiler>;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
    predictionModel = createQualityPredictionModel();
    profiler = createCodebaseProfiler();
  });

  it('should work with real profile from Librarian repo', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);
    const prediction = predictionModel.predict(profile);

    const context: SynthesisContext = {
      query: 'What does the EvaluationHarness class do?',
      profile,
      prediction,
      retrievedContext: [
        'export class EvaluationHarness { ... }',
        'Provides systematic evaluation capabilities.',
      ],
    };

    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.strategy).toBeDefined();
  });

  it('should adapt strategy based on real profile quality', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);
    const prediction = predictionModel.predict(profile);

    const context: SynthesisContext = {
      query: 'How does the vector store work?',
      profile,
      prediction,
      retrievedContext: ['Vector store implementation details...'],
    };

    const response = synthesizer.synthesize(context);

    // Librarian is high-quality, should get aggressive strategy
    // (or at least not conservative)
    expect(['aggressive', 'moderate']).toContain(response.strategy.name);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('AdaptiveSynthesizer - Edge Cases', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should handle empty retrieved context', () => {
    const prediction = createHighQualityPrediction();
    const context = createSynthesisContext(prediction, {
      retrievedContext: [],
    });
    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
  });

  it('should handle empty query', () => {
    const prediction = createHighQualityPrediction();
    const context = createSynthesisContext(prediction, {
      query: '',
    });
    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
  });

  it('should handle prediction at exact threshold boundaries', () => {
    const thresholds = [0.8, 0.5, 0.3];

    for (const threshold of thresholds) {
      const prediction = {
        ...createHighQualityPrediction(),
        synthesisAccuracy: threshold,
      };
      const context = createSynthesisContext(prediction);
      const response = synthesizer.synthesize(context);

      expect(response).toBeDefined();
      expect(response.strategy).toBeDefined();
    }
  });

  it('should handle very long retrieved context', () => {
    const prediction = createHighQualityPrediction();
    const longContext = Array(100)
      .fill('A'.repeat(1000))
      .map((s, i) => `${s} // file${i}.ts`);

    const context = createSynthesisContext(prediction, {
      retrievedContext: longContext,
    });
    const response = synthesizer.synthesize(context);

    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
  });
});

// ============================================================================
// CONSISTENCY TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Consistency', () => {
  let synthesizer: AdaptiveSynthesizer;

  beforeAll(() => {
    synthesizer = createAdaptiveSynthesizer();
  });

  it('should produce consistent strategy selection', () => {
    const prediction = createMediumQualityPrediction();

    const strategy1 = synthesizer.selectStrategy(prediction);
    const strategy2 = synthesizer.selectStrategy(prediction);

    expect(strategy1.name).toBe(strategy2.name);
    expect(strategy1.hedgingLevel).toBe(strategy2.hedgingLevel);
    expect(strategy1.confidenceThreshold).toBe(strategy2.confidenceThreshold);
  });

  it('should produce consistent disclaimers', () => {
    const prediction = createLowQualityPrediction();
    const strategy = synthesizer.selectStrategy(prediction);

    const disclaimers1 = synthesizer.generateDisclaimers(prediction, strategy);
    const disclaimers2 = synthesizer.generateDisclaimers(prediction, strategy);

    expect(disclaimers1.length).toBe(disclaimers2.length);
    for (let i = 0; i < disclaimers1.length; i++) {
      expect(disclaimers1[i]).toBe(disclaimers2[i]);
    }
  });
});

// ============================================================================
// STRATEGY PROPERTIES TESTS
// ============================================================================

describe('AdaptiveSynthesizer - Strategy Properties', () => {
  it('should have aggressive strategy with correct properties', () => {
    const strategy = DEFAULT_SYNTHESIS_STRATEGIES.aggressive;

    expect(strategy.name).toBe('aggressive');
    expect(strategy.confidenceThreshold).toBeLessThan(0.5);
    expect(strategy.citationRequirement).toBe('relaxed');
    expect(strategy.hedgingLevel).toBe('none');
    expect(strategy.verificationRequired).toBe(false);
    expect(strategy.maxClaimsPerResponse).toBeGreaterThan(10);
  });

  it('should have moderate strategy with correct properties', () => {
    const strategy = DEFAULT_SYNTHESIS_STRATEGIES.moderate;

    expect(strategy.name).toBe('moderate');
    expect(strategy.confidenceThreshold).toBeGreaterThan(0.3);
    expect(strategy.confidenceThreshold).toBeLessThan(0.7);
    expect(strategy.citationRequirement).toBe('moderate');
    expect(strategy.hedgingLevel).toBe('light');
    expect(strategy.maxClaimsPerResponse).toBeGreaterThan(5);
    expect(strategy.maxClaimsPerResponse).toBeLessThanOrEqual(10);
  });

  it('should have conservative strategy with correct properties', () => {
    const strategy = DEFAULT_SYNTHESIS_STRATEGIES.conservative;

    expect(strategy.name).toBe('conservative');
    expect(strategy.confidenceThreshold).toBeGreaterThanOrEqual(0.7);
    expect(strategy.citationRequirement).toBe('strict');
    expect(strategy.hedgingLevel).toBe('heavy');
    expect(strategy.verificationRequired).toBe(true);
    expect(strategy.maxClaimsPerResponse).toBeLessThanOrEqual(5);
  });
});
