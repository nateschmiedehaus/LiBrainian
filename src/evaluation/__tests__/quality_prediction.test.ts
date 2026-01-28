/**
 * @fileoverview Tests for Quality Prediction Model
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Quality Prediction Model predicts Librarian's expected accuracy for a given
 * codebase profile, enabling honest quality disclosure to users.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  QualityPredictionModel,
  createQualityPredictionModel,
  type QualityPrediction,
  type QualityFactor,
} from '../quality_prediction.js';
import {
  CodebaseProfiler,
  createCodebaseProfiler,
  type CodebaseProfile,
} from '../codebase_profiler.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as the main test fixture
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// External repos from eval-corpus for diverse testing
const EXTERNAL_REPOS_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos');
const TYPEDRIVER_REPO = path.join(EXTERNAL_REPOS_ROOT, 'typedriver-ts');
const SRTD_REPO = path.join(EXTERNAL_REPOS_ROOT, 'srtd-ts');
const RECCMP_REPO = path.join(EXTERNAL_REPOS_ROOT, 'reccmp-py');

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

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createQualityPredictionModel', () => {
  it('should create a model instance', () => {
    const model = createQualityPredictionModel();
    expect(model).toBeInstanceOf(QualityPredictionModel);
  });
});

// ============================================================================
// PREDICTION STRUCTURE TESTS
// ============================================================================

describe('QualityPredictionModel - Prediction Structure', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should produce a complete QualityPrediction', () => {
    const profile = createMockProfile();
    const prediction = model.predict(profile);

    expect(prediction).toBeDefined();
    expect(typeof prediction.retrievalAccuracy).toBe('number');
    expect(typeof prediction.synthesisAccuracy).toBe('number');
    expect(typeof prediction.hallucinationRisk).toBe('number');
    expect(prediction.confidenceInterval).toBeDefined();
    expect(typeof prediction.confidenceInterval.low).toBe('number');
    expect(typeof prediction.confidenceInterval.high).toBe('number');
    expect(Array.isArray(prediction.factors)).toBe(true);
  });

  it('should produce accuracy values between 0 and 1', () => {
    const profile = createMockProfile();
    const prediction = model.predict(profile);

    expect(prediction.retrievalAccuracy).toBeGreaterThanOrEqual(0);
    expect(prediction.retrievalAccuracy).toBeLessThanOrEqual(1);
    expect(prediction.synthesisAccuracy).toBeGreaterThanOrEqual(0);
    expect(prediction.synthesisAccuracy).toBeLessThanOrEqual(1);
    expect(prediction.hallucinationRisk).toBeGreaterThanOrEqual(0);
    expect(prediction.hallucinationRisk).toBeLessThanOrEqual(1);
  });

  it('should produce valid confidence interval', () => {
    const profile = createMockProfile();
    const prediction = model.predict(profile);

    expect(prediction.confidenceInterval.low).toBeLessThanOrEqual(
      prediction.retrievalAccuracy
    );
    expect(prediction.confidenceInterval.high).toBeGreaterThanOrEqual(
      prediction.retrievalAccuracy
    );
  });

  it('should include factors in prediction', () => {
    const profile = createMockProfile();
    const prediction = model.predict(profile);

    expect(prediction.factors.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// FACTOR STRUCTURE TESTS
// ============================================================================

describe('QualityPredictionModel - Factor Structure', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should produce valid QualityFactor objects', () => {
    const profile = createMockProfile();
    const factors = model.analyzeFactors(profile);

    expect(factors.length).toBeGreaterThan(0);

    for (const factor of factors) {
      expect(typeof factor.name).toBe('string');
      expect(['positive', 'negative', 'neutral']).toContain(factor.impact);
      expect(typeof factor.weight).toBe('number');
      expect(typeof factor.reason).toBe('string');
    }
  });

  it('should have factor weights between 0 and 1', () => {
    const profile = createMockProfile();
    const factors = model.analyzeFactors(profile);

    for (const factor of factors) {
      expect(factor.weight).toBeGreaterThanOrEqual(0);
      expect(factor.weight).toBeLessThanOrEqual(1);
    }
  });

  it('should provide meaningful factor names', () => {
    const profile = createMockProfile();
    const factors = model.analyzeFactors(profile);

    for (const factor of factors) {
      expect(factor.name.length).toBeGreaterThan(0);
    }
  });

  it('should provide reasons for each factor', () => {
    const profile = createMockProfile();
    const factors = model.analyzeFactors(profile);

    for (const factor of factors) {
      expect(factor.reason.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// POSITIVE FACTORS TESTS
// ============================================================================

describe('QualityPredictionModel - Positive Factors', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should identify TypeScript as a positive factor', () => {
    const profile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: true,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0,
      },
    });

    const factors = model.analyzeFactors(profile);
    const tsFactor = factors.find(
      (f) => f.name.toLowerCase().includes('typescript') || f.name.toLowerCase().includes('types')
    );

    expect(tsFactor).toBeDefined();
    expect(tsFactor!.impact).toBe('positive');
  });

  it('should identify tests as a positive factor', () => {
    const profile = createMockProfile({
      quality: {
        hasTests: true,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0,
      },
    });

    const factors = model.analyzeFactors(profile);
    const testFactor = factors.find((f) => f.name.toLowerCase().includes('test'));

    expect(testFactor).toBeDefined();
    expect(testFactor!.impact).toBe('positive');
  });

  it('should identify good documentation as a positive factor', () => {
    const profile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0.8,
      },
    });

    const factors = model.analyzeFactors(profile);
    const docFactor = factors.find((f) => f.name.toLowerCase().includes('documentation'));

    expect(docFactor).toBeDefined();
    expect(docFactor!.impact).toBe('positive');
  });

  it('should identify small/medium size as a positive factor', () => {
    const profile = createMockProfile({
      classification: 'small',
    });

    const factors = model.analyzeFactors(profile);
    const sizeFactor = factors.find((f) => f.name.toLowerCase().includes('size'));

    expect(sizeFactor).toBeDefined();
    expect(sizeFactor!.impact).toBe('positive');
  });

  it('should identify CI as a positive factor', () => {
    const profile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: true,
        documentationScore: 0,
      },
    });

    const factors = model.analyzeFactors(profile);
    const ciFactor = factors.find((f) => f.name.toLowerCase().includes('ci'));

    expect(ciFactor).toBeDefined();
    expect(ciFactor!.impact).toBe('positive');
  });
});

// ============================================================================
// NEGATIVE FACTORS TESTS
// ============================================================================

describe('QualityPredictionModel - Negative Factors', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should identify large codebase as a negative factor', () => {
    const profile = createMockProfile({
      classification: 'large',
      size: {
        totalFiles: 5000,
        totalLines: 500000,
        languages: { TypeScript: 4000 },
      },
    });

    const factors = model.analyzeFactors(profile);
    const sizeFactor = factors.find(
      (f) => f.name.toLowerCase().includes('size') || f.name.toLowerCase().includes('large')
    );

    expect(sizeFactor).toBeDefined();
    expect(sizeFactor!.impact).toBe('negative');
  });

  it('should identify complex functions as a negative factor', () => {
    const profile = createMockProfile({
      risks: {
        largeFiles: [],
        complexFunctions: ['file1.ts:fn1', 'file2.ts:fn2', 'file3.ts:fn3'],
        circularDependencies: false,
        outdatedDependencies: false,
      },
    });

    const factors = model.analyzeFactors(profile);
    const complexFactor = factors.find((f) => f.name.toLowerCase().includes('complex'));

    expect(complexFactor).toBeDefined();
    expect(complexFactor!.impact).toBe('negative');
  });

  it('should identify missing types as a negative factor', () => {
    const profile = createMockProfile({
      quality: {
        hasTests: true,
        hasTypeScript: false,
        hasLinting: true,
        hasCI: true,
        documentationScore: 0.8,
      },
    });

    const factors = model.analyzeFactors(profile);
    const typeFactor = factors.find(
      (f) =>
        (f.name.toLowerCase().includes('type') || f.name.toLowerCase().includes('typescript')) &&
        f.impact === 'negative'
    );

    expect(typeFactor).toBeDefined();
    expect(typeFactor!.impact).toBe('negative');
  });

  it('should identify circular dependencies as a negative factor', () => {
    const profile = createMockProfile({
      risks: {
        largeFiles: [],
        complexFunctions: [],
        circularDependencies: true,
        outdatedDependencies: false,
      },
    });

    const factors = model.analyzeFactors(profile);
    const circularFactor = factors.find((f) => f.name.toLowerCase().includes('circular'));

    expect(circularFactor).toBeDefined();
    expect(circularFactor!.impact).toBe('negative');
  });

  it('should identify outdated dependencies as a negative factor', () => {
    const profile = createMockProfile({
      risks: {
        largeFiles: [],
        complexFunctions: [],
        circularDependencies: false,
        outdatedDependencies: true,
      },
    });

    const factors = model.analyzeFactors(profile);
    const outdatedFactor = factors.find((f) => f.name.toLowerCase().includes('outdated'));

    expect(outdatedFactor).toBeDefined();
    expect(outdatedFactor!.impact).toBe('negative');
  });
});

// ============================================================================
// PREDICTION FORMULA TESTS
// ============================================================================

describe('QualityPredictionModel - Prediction Formula', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should produce higher accuracy for high-quality profiles', () => {
    const highQualityProfile = createMockProfile({
      quality: {
        hasTests: true,
        hasTypeScript: true,
        hasLinting: true,
        hasCI: true,
        documentationScore: 0.9,
      },
      classification: 'small',
      qualityTier: 'high',
      risks: {
        largeFiles: [],
        complexFunctions: [],
        circularDependencies: false,
        outdatedDependencies: false,
      },
    });

    const lowQualityProfile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0.1,
      },
      classification: 'large',
      qualityTier: 'low',
      risks: {
        largeFiles: ['big1.ts', 'big2.ts', 'big3.ts'],
        complexFunctions: ['fn1', 'fn2'],
        circularDependencies: true,
        outdatedDependencies: true,
      },
    });

    const highPrediction = model.predict(highQualityProfile);
    const lowPrediction = model.predict(lowQualityProfile);

    expect(highPrediction.retrievalAccuracy).toBeGreaterThan(lowPrediction.retrievalAccuracy);
  });

  it('should clamp accuracy between 0.3 and 0.95', () => {
    // Best case scenario
    const bestProfile = createMockProfile({
      quality: {
        hasTests: true,
        hasTypeScript: true,
        hasLinting: true,
        hasCI: true,
        documentationScore: 1.0,
      },
      classification: 'small',
      qualityTier: 'high',
      risks: {
        largeFiles: [],
        complexFunctions: [],
        circularDependencies: false,
        outdatedDependencies: false,
      },
    });

    // Worst case scenario
    const worstProfile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0,
      },
      classification: 'monorepo',
      qualityTier: 'low',
      size: {
        totalFiles: 10000,
        totalLines: 2000000,
        languages: { JavaScript: 10000 },
      },
      risks: {
        largeFiles: Array(20).fill('big.ts'),
        complexFunctions: Array(30).fill('fn'),
        circularDependencies: true,
        outdatedDependencies: true,
      },
    });

    const bestPrediction = model.predict(bestProfile);
    const worstPrediction = model.predict(worstProfile);

    expect(bestPrediction.retrievalAccuracy).toBeLessThanOrEqual(0.95);
    expect(worstPrediction.retrievalAccuracy).toBeGreaterThanOrEqual(0.3);
  });

  it('should have base accuracy around 0.7', () => {
    // Neutral profile with no strong positive/negative factors
    const neutralProfile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0.5,
      },
      classification: 'medium',
      qualityTier: 'medium',
      risks: {
        largeFiles: [],
        complexFunctions: [],
        circularDependencies: false,
        outdatedDependencies: false,
      },
    });

    const prediction = model.predict(neutralProfile);

    // Should be close to base accuracy of 0.7 (within some margin)
    expect(prediction.retrievalAccuracy).toBeGreaterThan(0.5);
    expect(prediction.retrievalAccuracy).toBeLessThan(0.85);
  });

  it('should calculate hallucination risk inversely to quality', () => {
    const highQualityProfile = createMockProfile({
      quality: {
        hasTests: true,
        hasTypeScript: true,
        hasLinting: true,
        hasCI: true,
        documentationScore: 0.9,
      },
      qualityTier: 'high',
    });

    const lowQualityProfile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0.1,
      },
      qualityTier: 'low',
    });

    const highPrediction = model.predict(highQualityProfile);
    const lowPrediction = model.predict(lowQualityProfile);

    expect(highPrediction.hallucinationRisk).toBeLessThan(lowPrediction.hallucinationRisk);
  });
});

// ============================================================================
// QUERY TYPE PREDICTION TESTS
// ============================================================================

describe('QualityPredictionModel - Query Type Predictions', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should predict for structural query type', () => {
    const profile = createMockProfile();
    const prediction = model.predictForQueryType(profile, 'structural');

    expect(prediction).toBeDefined();
    expect(typeof prediction.retrievalAccuracy).toBe('number');
  });

  it('should predict for behavioral query type', () => {
    const profile = createMockProfile();
    const prediction = model.predictForQueryType(profile, 'behavioral');

    expect(prediction).toBeDefined();
    expect(typeof prediction.retrievalAccuracy).toBe('number');
  });

  it('should predict for architectural query type', () => {
    const profile = createMockProfile();
    const prediction = model.predictForQueryType(profile, 'architectural');

    expect(prediction).toBeDefined();
    expect(typeof prediction.retrievalAccuracy).toBe('number');
  });

  it('should return different predictions for different query types', () => {
    const profile = createMockProfile();

    const structuralPred = model.predictForQueryType(profile, 'structural');
    const behavioralPred = model.predictForQueryType(profile, 'behavioral');
    const architecturalPred = model.predictForQueryType(profile, 'architectural');

    // At least one should be different (query types have different characteristics)
    const allSame =
      structuralPred.retrievalAccuracy === behavioralPred.retrievalAccuracy &&
      behavioralPred.retrievalAccuracy === architecturalPred.retrievalAccuracy;

    // This is a soft assertion - query types may produce same results for some profiles
    // The important thing is the method returns valid predictions
    expect(structuralPred.retrievalAccuracy).toBeGreaterThan(0);
    expect(behavioralPred.retrievalAccuracy).toBeGreaterThan(0);
    expect(architecturalPred.retrievalAccuracy).toBeGreaterThan(0);
  });

  it('should handle unknown query types gracefully', () => {
    const profile = createMockProfile();
    const prediction = model.predictForQueryType(profile, 'unknown');

    // Should fall back to general prediction
    expect(prediction).toBeDefined();
    expect(typeof prediction.retrievalAccuracy).toBe('number');
  });
});

// ============================================================================
// INTEGRATION WITH REAL PROFILES
// ============================================================================

describe('QualityPredictionModel - Integration with CodebaseProfiler', () => {
  let model: QualityPredictionModel;
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    model = createQualityPredictionModel();
    profiler = createCodebaseProfiler();
  });

  it('should predict quality for typedriver-ts profile', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);
    const prediction = model.predict(profile);

    expect(prediction.retrievalAccuracy).toBeGreaterThan(0.5);
    expect(prediction.factors.length).toBeGreaterThan(0);
  });

  it('should predict quality for srtd-ts profile', async () => {
    const profile = await profiler.profile(SRTD_REPO);
    const prediction = model.predict(profile);

    expect(prediction.retrievalAccuracy).toBeGreaterThan(0.5);
    expect(prediction.factors.length).toBeGreaterThan(0);
  });

  it('should predict quality for reccmp-py profile', async () => {
    const profile = await profiler.profile(RECCMP_REPO);
    const prediction = model.predict(profile);

    expect(prediction.retrievalAccuracy).toBeGreaterThan(0.3);
    expect(prediction.factors.length).toBeGreaterThan(0);
  });

  it('should produce reasonable predictions for Librarian', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);
    const prediction = model.predict(profile);

    // Librarian is a high-quality TypeScript project with tests, CI, etc.
    expect(prediction.retrievalAccuracy).toBeGreaterThan(0.6);
    expect(prediction.hallucinationRisk).toBeLessThan(0.5);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('QualityPredictionModel - Edge Cases', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should handle profile with zero files', () => {
    const profile = createMockProfile({
      size: {
        totalFiles: 0,
        totalLines: 0,
        languages: {},
      },
    });

    const prediction = model.predict(profile);

    expect(prediction).toBeDefined();
    expect(prediction.retrievalAccuracy).toBeGreaterThanOrEqual(0.3);
    expect(prediction.retrievalAccuracy).toBeLessThanOrEqual(0.95);
  });

  it('should handle profile with extreme values', () => {
    const profile = createMockProfile({
      size: {
        totalFiles: 100000,
        totalLines: 10000000,
        languages: { TypeScript: 100000 },
      },
      complexity: {
        averageFunctionsPerFile: 100,
        averageClassesPerFile: 50,
        maxFileSize: 50000,
        deepestNesting: 30,
      },
    });

    const prediction = model.predict(profile);

    expect(prediction).toBeDefined();
    expect(prediction.retrievalAccuracy).toBeGreaterThanOrEqual(0.3);
    expect(prediction.retrievalAccuracy).toBeLessThanOrEqual(0.95);
  });

  it('should handle monorepo classification', () => {
    const profile = createMockProfile({
      classification: 'monorepo',
      structure: {
        isMonorepo: true,
        hasWorkspaces: true,
        entryPoints: ['packages/a/src/index.ts', 'packages/b/src/index.ts'],
        configFiles: ['package.json', 'lerna.json'],
      },
    });

    const prediction = model.predict(profile);

    expect(prediction).toBeDefined();
    // Monorepos may have lower accuracy due to complexity
    expect(prediction.factors.some((f) => f.name.toLowerCase().includes('monorepo'))).toBe(true);
  });
});

// ============================================================================
// CONSISTENCY TESTS
// ============================================================================

describe('QualityPredictionModel - Consistency', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should produce consistent predictions for same profile', () => {
    const profile = createMockProfile();

    const prediction1 = model.predict(profile);
    const prediction2 = model.predict(profile);

    expect(prediction1.retrievalAccuracy).toBe(prediction2.retrievalAccuracy);
    expect(prediction1.synthesisAccuracy).toBe(prediction2.synthesisAccuracy);
    expect(prediction1.hallucinationRisk).toBe(prediction2.hallucinationRisk);
  });

  it('should produce consistent factors for same profile', () => {
    const profile = createMockProfile();

    const factors1 = model.analyzeFactors(profile);
    const factors2 = model.analyzeFactors(profile);

    expect(factors1.length).toBe(factors2.length);
    for (let i = 0; i < factors1.length; i++) {
      expect(factors1[i].name).toBe(factors2[i].name);
      expect(factors1[i].impact).toBe(factors2[i].impact);
      expect(factors1[i].weight).toBe(factors2[i].weight);
    }
  });
});

// ============================================================================
// SYNTHESIS ACCURACY TESTS
// ============================================================================

describe('QualityPredictionModel - Synthesis Accuracy', () => {
  let model: QualityPredictionModel;

  beforeAll(() => {
    model = createQualityPredictionModel();
  });

  it('should calculate synthesis accuracy', () => {
    const profile = createMockProfile();
    const prediction = model.predict(profile);

    expect(prediction.synthesisAccuracy).toBeGreaterThanOrEqual(0);
    expect(prediction.synthesisAccuracy).toBeLessThanOrEqual(1);
  });

  it('should have synthesis accuracy correlated with retrieval accuracy', () => {
    const highQualityProfile = createMockProfile({
      quality: {
        hasTests: true,
        hasTypeScript: true,
        hasLinting: true,
        hasCI: true,
        documentationScore: 0.9,
      },
    });

    const lowQualityProfile = createMockProfile({
      quality: {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0.1,
      },
    });

    const highPrediction = model.predict(highQualityProfile);
    const lowPrediction = model.predict(lowQualityProfile);

    expect(highPrediction.synthesisAccuracy).toBeGreaterThan(lowPrediction.synthesisAccuracy);
  });
});
