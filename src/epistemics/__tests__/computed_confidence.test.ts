/**
 * @fileoverview Tests for Computed Confidence from Signals
 *
 * Comprehensive tests verifying that confidence computation:
 * 1. Eliminates the uniform 0.5 problem
 * 2. Provides real variance across entities
 * 3. Respects bounds [0.15, 0.85]
 * 4. Properly weights component contributions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeConfidence,
  computeConfidenceBatch,
  computeConfidenceStats,
  extractSignalsFromFunction,
  extractSignalsFromFile,
  extractSignalsFromContextPack,
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  COMPONENT_WEIGHTS,
  type ConfidenceSignals,
  type ComputedConfidenceResult,
} from '../computed_confidence.js';
import type { FunctionKnowledge, FileKnowledge, ContextPack, LiBrainianVersion } from '../../types.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestSignals(overrides: Partial<ConfidenceSignals> = {}): ConfidenceSignals {
  return {
    structural: {
      typeAnnotationRatio: 0.5,
      hasDocstring: false,
      docstringQuality: 0,
      isExported: false,
      hasPublicAPI: false,
      complexity: 'medium',
      lineCount: 50,
      ...overrides.structural,
    },
    semantic: {
      purposeQuality: 0.5,
      embeddingCohesion: 0.5,
      hasClearResponsibility: true,
      ...overrides.semantic,
    },
    historical: {
      retrievalCount: 0,
      retrievalSuccessRate: 0.5,
      validationCount: 0,
      validationPassRate: 0.5,
      daysSinceLastAccess: null,
      ...overrides.historical,
    },
    crossValidation: {
      extractorAgreementCount: 1,
      extractorTotalCount: 1,
      disagreements: [],
      ...overrides.crossValidation,
    },
  };
}

function createTestFunction(overrides: Partial<FunctionKnowledge> = {}): FunctionKnowledge {
  return {
    id: 'test-fn-1',
    filePath: '/src/test.ts',
    name: 'testFunction',
    signature: 'function testFunction(a: number, b: string): boolean',
    purpose: 'Validates input parameters and returns a boolean result',
    startLine: 10,
    endLine: 30,
    confidence: 0.5,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
    ...overrides,
  };
}

function createTestFile(overrides: Partial<FileKnowledge> = {}): FileKnowledge {
  return {
    id: 'test-file-1',
    path: '/src/test.ts',
    relativePath: 'src/test.ts',
    name: 'test.ts',
    extension: '.ts',
    category: 'code',
    purpose: 'Contains utility functions for testing',
    role: 'utility',
    summary: 'A comprehensive utility module with well-documented functions',
    keyExports: ['testFunction', 'helper'],
    mainConcepts: ['validation', 'transformation'],
    lineCount: 100,
    functionCount: 5,
    classCount: 0,
    importCount: 3,
    exportCount: 2,
    imports: [],
    importedBy: [],
    directory: '/src',
    complexity: 'medium',
    hasTests: true,
    checksum: 'abc123',
    confidence: 0.5,
    lastIndexed: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    ...overrides,
  };
}

const testVersion: LiBrainianVersion = {
  major: 0,
  minor: 1,
  patch: 0,
  string: '0.1.0',
  qualityTier: 'mvp',
  indexedAt: new Date(),
  indexerVersion: '1.0.0',
  features: [],
};

function createTestContextPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    packId: 'test-pack-1',
    packType: 'function_context',
    targetId: 'test-fn-1',
    summary: 'Context pack for test function with validation logic',
    keyFacts: ['Validates input', 'Returns boolean', 'Handles edge cases'],
    codeSnippets: [],
    relatedFiles: ['/src/test.ts'],
    confidence: 0.5,
    createdAt: new Date(),
    accessCount: 5,
    lastOutcome: 'success',
    successCount: 4,
    failureCount: 1,
    version: testVersion,
    invalidationTriggers: [],
    ...overrides,
  };
}

// ============================================================================
// STRUCTURAL SIGNALS TESTS
// ============================================================================

describe('ComputedConfidence', () => {
  describe('structural signals', () => {
    it('higher type coverage yields higher confidence', () => {
      const wellTyped = createTestSignals({
        structural: {
          typeAnnotationRatio: 1.0,
          hasDocstring: true,
          docstringQuality: 0.8,
          isExported: true,
          hasPublicAPI: true,
          complexity: 'low',
          lineCount: 50,
        },
      });
      const untyped = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.0,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 500,
        },
      });

      const wellTypedConf = computeConfidence(wellTyped);
      const untypedConf = computeConfidence(untyped);

      expect(wellTypedConf.components.structural).toBeGreaterThan(untypedConf.components.structural);
      expect(wellTypedConf.overall).toBeGreaterThan(untypedConf.overall);
    });

    it('docstrings increase confidence', () => {
      const documented = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.5,
          hasDocstring: true,
          docstringQuality: 0.9,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'medium',
          lineCount: 50,
        },
      });
      const undocumented = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.5,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'medium',
          lineCount: 50,
        },
      });

      const docConf = computeConfidence(documented);
      const undocConf = computeConfidence(undocumented);

      expect(docConf.components.structural).toBeGreaterThan(undocConf.components.structural);
    });

    it('exported symbols have higher confidence than internal', () => {
      const exported = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.5,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: true,
          hasPublicAPI: true,
          complexity: 'medium',
          lineCount: 50,
        },
      });
      const internal = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.5,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'medium',
          lineCount: 50,
        },
      });

      const exportedConf = computeConfidence(exported);
      const internalConf = computeConfidence(internal);

      expect(exportedConf.components.structural).toBeGreaterThan(internalConf.components.structural);
    });

    it('low complexity yields higher confidence than high complexity', () => {
      const simple = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.5,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'low',
          lineCount: 30,
        },
      });
      const complex = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.5,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 300,
        },
      });

      const simpleConf = computeConfidence(simple);
      const complexConf = computeConfidence(complex);

      expect(simpleConf.components.structural).toBeGreaterThan(complexConf.components.structural);
    });
  });

  // ============================================================================
  // SEMANTIC SIGNALS TESTS
  // ============================================================================

  describe('semantic signals', () => {
    it('clear purpose description yields higher confidence', () => {
      const clear = createTestSignals({
        semantic: {
          purposeQuality: 0.9,
          embeddingCohesion: 0.5,
          hasClearResponsibility: true,
        },
      });
      const vague = createTestSignals({
        semantic: {
          purposeQuality: 0.1,
          embeddingCohesion: 0.5,
          hasClearResponsibility: false,
        },
      });

      const clearConf = computeConfidence(clear);
      const vagueConf = computeConfidence(vague);

      expect(clearConf.components.semantic).toBeGreaterThan(vagueConf.components.semantic);
      expect(clearConf.overall).toBeGreaterThan(vagueConf.overall);
    });

    it('embedding cohesion affects confidence', () => {
      const coherent = createTestSignals({
        semantic: {
          purposeQuality: 0.5,
          embeddingCohesion: 0.9,
          hasClearResponsibility: true,
        },
      });
      const scattered = createTestSignals({
        semantic: {
          purposeQuality: 0.5,
          embeddingCohesion: 0.1,
          hasClearResponsibility: true,
        },
      });

      const coherentConf = computeConfidence(coherent);
      const scatteredConf = computeConfidence(scattered);

      expect(coherentConf.components.semantic).toBeGreaterThan(scatteredConf.components.semantic);
    });

    it('clear single responsibility increases confidence', () => {
      const focused = createTestSignals({
        semantic: {
          purposeQuality: 0.5,
          embeddingCohesion: 0.5,
          hasClearResponsibility: true,
        },
      });
      const unfocused = createTestSignals({
        semantic: {
          purposeQuality: 0.5,
          embeddingCohesion: 0.5,
          hasClearResponsibility: false,
        },
      });

      const focusedConf = computeConfidence(focused);
      const unfocusedConf = computeConfidence(unfocused);

      expect(focusedConf.components.semantic).toBeGreaterThan(unfocusedConf.components.semantic);
    });
  });

  // ============================================================================
  // HISTORICAL SIGNALS TESTS
  // ============================================================================

  describe('historical signals', () => {
    it('successful retrievals increase confidence', () => {
      const frequentlyUsed = createTestSignals({
        historical: {
          retrievalCount: 100,
          retrievalSuccessRate: 0.95,
          validationCount: 50,
          validationPassRate: 0.92,
          daysSinceLastAccess: 1,
        },
      });
      const neverUsed = createTestSignals({
        historical: {
          retrievalCount: 0,
          retrievalSuccessRate: 0,
          validationCount: 0,
          validationPassRate: 0,
          daysSinceLastAccess: null,
        },
      });

      const usedConf = computeConfidence(frequentlyUsed);
      const unusedConf = computeConfidence(neverUsed);

      expect(usedConf.components.historical).toBeGreaterThan(unusedConf.components.historical);
      expect(usedConf.overall).toBeGreaterThan(unusedConf.overall);
    });

    it('validation history affects confidence', () => {
      const validated = createTestSignals({
        historical: {
          retrievalCount: 10,
          retrievalSuccessRate: 0.8,
          validationCount: 50,
          validationPassRate: 0.92,
          daysSinceLastAccess: 5,
        },
      });
      const unvalidated = createTestSignals({
        historical: {
          retrievalCount: 10,
          retrievalSuccessRate: 0.8,
          validationCount: 0,
          validationPassRate: 0,
          daysSinceLastAccess: 5,
        },
      });

      const validatedConf = computeConfidence(validated);
      const unvalidatedConf = computeConfidence(unvalidated);

      expect(validatedConf.components.historical).toBeGreaterThan(unvalidatedConf.components.historical);
    });

    it('stale entities have lower confidence', () => {
      const fresh = createTestSignals({
        historical: {
          retrievalCount: 10,
          retrievalSuccessRate: 0.8,
          validationCount: 10,
          validationPassRate: 0.8,
          daysSinceLastAccess: 1,
        },
      });
      const stale = createTestSignals({
        historical: {
          retrievalCount: 10,
          retrievalSuccessRate: 0.8,
          validationCount: 10,
          validationPassRate: 0.8,
          daysSinceLastAccess: 100,
        },
      });

      const freshConf = computeConfidence(fresh);
      const staleConf = computeConfidence(stale);

      expect(freshConf.components.historical).toBeGreaterThan(staleConf.components.historical);
    });
  });

  // ============================================================================
  // CROSS-VALIDATION SIGNALS TESTS
  // ============================================================================

  describe('cross-validation signals', () => {
    it('extractor agreement increases confidence', () => {
      const agreed = createTestSignals({
        crossValidation: {
          extractorAgreementCount: 3,
          extractorTotalCount: 3,
          disagreements: [],
        },
      });
      const disagreed = createTestSignals({
        crossValidation: {
          extractorAgreementCount: 1,
          extractorTotalCount: 3,
          disagreements: ['Type disagreement: function vs class'],
        },
      });

      const agreedConf = computeConfidence(agreed);
      const disagreedConf = computeConfidence(disagreed);

      expect(agreedConf.components.crossValidation).toBeGreaterThan(0);
      expect(disagreedConf.components.crossValidation).toBeLessThan(agreedConf.components.crossValidation);
    });

    it('cross-validation can be negative on strong disagreement', () => {
      const strongDisagreement = createTestSignals({
        crossValidation: {
          extractorAgreementCount: 0,
          extractorTotalCount: 3,
          disagreements: ['Type disagreement', 'Name disagreement', 'Scope disagreement'],
        },
      });

      const conf = computeConfidence(strongDisagreement);

      expect(conf.components.crossValidation).toBeLessThan(0);
    });
  });

  // ============================================================================
  // DISTRIBUTION PROPERTIES TESTS
  // ============================================================================

  describe('distribution properties', () => {
    it('eliminates uniform 0.5 problem', () => {
      // Create entities with varying characteristics
      const entities = [
        // High quality entity
        createTestSignals({
          structural: {
            typeAnnotationRatio: 1.0,
            hasDocstring: true,
            docstringQuality: 0.9,
            isExported: true,
            hasPublicAPI: true,
            complexity: 'low',
            lineCount: 50,
          },
          semantic: {
            purposeQuality: 0.9,
            embeddingCohesion: 0.9,
            hasClearResponsibility: true,
          },
          historical: {
            retrievalCount: 50,
            retrievalSuccessRate: 0.95,
            validationCount: 20,
            validationPassRate: 0.9,
            daysSinceLastAccess: 2,
          },
        }),
        // Medium quality entity
        createTestSignals(),
        // Low quality entity
        createTestSignals({
          structural: {
            typeAnnotationRatio: 0.0,
            hasDocstring: false,
            docstringQuality: 0,
            isExported: false,
            hasPublicAPI: false,
            complexity: 'high',
            lineCount: 500,
          },
          semantic: {
            purposeQuality: 0.1,
            embeddingCohesion: 0.2,
            hasClearResponsibility: false,
          },
          historical: {
            retrievalCount: 3,
            retrievalSuccessRate: 0.3,
            validationCount: 5,
            validationPassRate: 0.2,
            daysSinceLastAccess: 90,
          },
        }),
      ];

      const confidences = entities.map(computeConfidence);
      const values = confidences.map((c) => c.overall);

      // Compute variance
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;

      // Must have real variance - NOT all 0.5
      expect(variance).toBeGreaterThan(0.01);
      expect(values.some((v) => v > 0.6)).toBe(true); // Some high confidence
      expect(values.some((v) => v < 0.4)).toBe(true); // Some low confidence
    });

    it('confidence range is [0.15, 0.85] - never certain, never clueless', () => {
      // Test extreme cases
      const perfectSignals = createTestSignals({
        structural: {
          typeAnnotationRatio: 1.0,
          hasDocstring: true,
          docstringQuality: 1.0,
          isExported: true,
          hasPublicAPI: true,
          complexity: 'low',
          lineCount: 50,
        },
        semantic: {
          purposeQuality: 1.0,
          embeddingCohesion: 1.0,
          hasClearResponsibility: true,
        },
        historical: {
          retrievalCount: 1000,
          retrievalSuccessRate: 1.0,
          validationCount: 500,
          validationPassRate: 1.0,
          daysSinceLastAccess: 0,
        },
        crossValidation: {
          extractorAgreementCount: 5,
          extractorTotalCount: 5,
          disagreements: [],
        },
      });

      const worstSignals = createTestSignals({
        structural: {
          typeAnnotationRatio: 0,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 2000,
        },
        semantic: {
          purposeQuality: 0,
          embeddingCohesion: 0,
          hasClearResponsibility: false,
        },
        historical: {
          retrievalCount: 100,
          retrievalSuccessRate: 0,
          validationCount: 100,
          validationPassRate: 0,
          daysSinceLastAccess: 365,
        },
        crossValidation: {
          extractorAgreementCount: 0,
          extractorTotalCount: 5,
          disagreements: ['everything disagrees'],
        },
      });

      const perfectConf = computeConfidence(perfectSignals);
      const worstConf = computeConfidence(worstSignals);

      // Perfect should hit ceiling
      expect(perfectConf.overall).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(perfectConf.overall).toBeGreaterThanOrEqual(CONFIDENCE_CEILING - 0.05);

      // Worst should hit floor
      expect(worstConf.overall).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
      expect(worstConf.overall).toBeLessThanOrEqual(CONFIDENCE_FLOOR + 0.1);
    });
  });

  // ============================================================================
  // COMPONENT WEIGHTING TESTS
  // ============================================================================

  describe('component weighting', () => {
    it('structural contributes up to 50%', () => {
      const perfectStructural = createTestSignals({
        structural: {
          typeAnnotationRatio: 1.0,
          hasDocstring: true,
          docstringQuality: 1.0,
          isExported: true,
          hasPublicAPI: true,
          complexity: 'low',
          lineCount: 50,
        },
        semantic: {
          purposeQuality: 0,
          embeddingCohesion: 0,
          hasClearResponsibility: false,
        },
        historical: {
          retrievalCount: 0,
          retrievalSuccessRate: 0,
          validationCount: 0,
          validationPassRate: 0,
          daysSinceLastAccess: null,
        },
      });

      const conf = computeConfidence(perfectStructural);

      expect(conf.contributions.structuralContribution).toBeLessThanOrEqual(
        COMPONENT_WEIGHTS.structural
      );
    });

    it('semantic contributes up to 30%', () => {
      const perfectSemantic = createTestSignals({
        structural: {
          typeAnnotationRatio: 0,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 500,
        },
        semantic: {
          purposeQuality: 1.0,
          embeddingCohesion: 1.0,
          hasClearResponsibility: true,
        },
        historical: {
          retrievalCount: 0,
          retrievalSuccessRate: 0,
          validationCount: 0,
          validationPassRate: 0,
          daysSinceLastAccess: null,
        },
      });

      const conf = computeConfidence(perfectSemantic);

      expect(conf.contributions.semanticContribution).toBeLessThanOrEqual(
        COMPONENT_WEIGHTS.semantic
      );
    });

    it('historical contributes up to 15%', () => {
      const perfectHistorical = createTestSignals({
        structural: {
          typeAnnotationRatio: 0,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 500,
        },
        semantic: {
          purposeQuality: 0,
          embeddingCohesion: 0,
          hasClearResponsibility: false,
        },
        historical: {
          retrievalCount: 1000,
          retrievalSuccessRate: 1.0,
          validationCount: 500,
          validationPassRate: 1.0,
          daysSinceLastAccess: 0,
        },
      });

      const conf = computeConfidence(perfectHistorical);

      expect(conf.contributions.historicalContribution).toBeLessThanOrEqual(
        COMPONENT_WEIGHTS.historical
      );
    });

    it('cross-validation adjusts by at most ±10%', () => {
      const maxAgreement = createTestSignals({
        crossValidation: {
          extractorAgreementCount: 10,
          extractorTotalCount: 10,
          disagreements: [],
        },
      });

      const maxDisagreement = createTestSignals({
        crossValidation: {
          extractorAgreementCount: 0,
          extractorTotalCount: 10,
          disagreements: ['total disagreement'],
        },
      });

      const agreeConf = computeConfidence(maxAgreement);
      const disagreeConf = computeConfidence(maxDisagreement);

      // Cross-validation is an adjustment, not a weighted contribution
      expect(Math.abs(agreeConf.components.crossValidation)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(disagreeConf.components.crossValidation)).toBeLessThanOrEqual(0.1);
    });
  });

  // ============================================================================
  // ENTITY ADAPTER TESTS
  // ============================================================================

  describe('entity adapters', () => {
    describe('extractSignalsFromFunction', () => {
      it('extracts signals from well-typed function', () => {
        const fn = createTestFunction({
          signature: 'function compute(a: number, b: string): boolean',
          purpose: 'Validates input parameters and returns a boolean result indicating success',
          accessCount: 10,
          validationCount: 5,
          outcomeHistory: { successes: 8, failures: 2 },
          lastAccessed: new Date(Date.now() - 86400000), // 1 day ago
        });

        const signals = extractSignalsFromFunction(fn);

        expect(signals.structural.typeAnnotationRatio).toBeGreaterThan(0.5);
        expect(signals.structural.hasDocstring).toBe(true);
        expect(signals.historical.retrievalCount).toBe(10);
        expect(signals.historical.retrievalSuccessRate).toBe(0.8);
      });

      it('extracts signals from poorly-typed function', () => {
        const fn = createTestFunction({
          signature: 'function compute(a, b)',
          purpose: 'does stuff',
          accessCount: 0,
          validationCount: 0,
          outcomeHistory: { successes: 0, failures: 0 },
          lastAccessed: null,
        });

        const signals = extractSignalsFromFunction(fn);

        expect(signals.structural.typeAnnotationRatio).toBeLessThan(0.5);
        expect(signals.semantic.purposeQuality).toBeLessThan(0.3);
      });
    });

    describe('extractSignalsFromFile', () => {
      it('extracts signals from well-documented file', () => {
        const file = createTestFile({
          summary: 'A comprehensive utility module providing validation and transformation functions for data processing',
          purpose: 'Handles data validation and transformation for the core processing pipeline',
          exportCount: 5,
          complexity: 'low',
          lineCount: 150,
          mainConcepts: ['validation'],
        });

        const signals = extractSignalsFromFile(file);

        expect(signals.structural.hasDocstring).toBe(true);
        expect(signals.structural.isExported).toBe(true);
        expect(signals.semantic.hasClearResponsibility).toBe(true);
      });
    });

    describe('extractSignalsFromContextPack', () => {
      it('extracts signals from successful context pack', () => {
        const pack = createTestContextPack({
          accessCount: 20,
          successCount: 18,
          failureCount: 2,
          summary: 'Context pack for authentication validation that handles token verification and session management',
        });

        const signals = extractSignalsFromContextPack(pack);

        expect(signals.historical.retrievalCount).toBe(20);
        expect(signals.historical.retrievalSuccessRate).toBe(0.9);
        expect(signals.semantic.purposeQuality).toBeGreaterThan(0.5);
      });
    });
  });

  // ============================================================================
  // BATCH COMPUTATION TESTS
  // ============================================================================

  describe('batch computation', () => {
    it('computes confidence for multiple entities', () => {
      const entities = [
        { id: 'entity-1', signals: createTestSignals() },
        {
          id: 'entity-2',
          signals: createTestSignals({
            structural: {
              typeAnnotationRatio: 1.0,
              hasDocstring: true,
              docstringQuality: 0.9,
              isExported: true,
              hasPublicAPI: true,
              complexity: 'low',
              lineCount: 50,
            },
          }),
        },
        {
          id: 'entity-3',
          signals: createTestSignals({
            semantic: { purposeQuality: 0.1, embeddingCohesion: 0.2, hasClearResponsibility: false },
          }),
        },
      ];

      const results = computeConfidenceBatch(entities);

      expect(results.size).toBe(3);
      expect(results.get('entity-1')).toBeDefined();
      expect(results.get('entity-2')!.overall).toBeGreaterThan(results.get('entity-1')!.overall);
      expect(results.get('entity-3')!.overall).toBeLessThan(results.get('entity-1')!.overall);
    });
  });

  // ============================================================================
  // STATISTICS TESTS
  // ============================================================================

  describe('confidence statistics', () => {
    it('computes statistics correctly', () => {
      const confidences = [0.3, 0.4, 0.5, 0.6, 0.7];
      const stats = computeConfidenceStats(confidences);

      expect(stats.mean).toBe(0.5);
      expect(stats.min).toBe(0.3);
      expect(stats.max).toBe(0.7);
      expect(stats.median).toBe(0.5);
      expect(stats.variance).toBeGreaterThan(0);
      expect(stats.stdDev).toBeGreaterThan(0);
    });

    it('handles empty array', () => {
      const stats = computeConfidenceStats([]);

      expect(stats.mean).toBe(0.5);
      expect(stats.variance).toBe(0);
    });

    it('handles single value', () => {
      const stats = computeConfidenceStats([0.7]);

      expect(stats.mean).toBe(0.7);
      expect(stats.min).toBe(0.7);
      expect(stats.max).toBe(0.7);
      expect(stats.median).toBe(0.7);
      expect(stats.variance).toBe(0);
    });
  });

  // ============================================================================
  // DIAGNOSTIC INFORMATION TESTS
  // ============================================================================

  describe('diagnostic information', () => {
    it('provides factors explaining confidence level', () => {
      const signals = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.95,
          hasDocstring: true,
          docstringQuality: 0.85,
          isExported: true,
          hasPublicAPI: true,
          complexity: 'low',
          lineCount: 50,
        },
      });

      const conf = computeConfidence(signals);

      expect(conf.diagnostics.factors.length).toBeGreaterThan(0);
      expect(conf.diagnostics.factors.some((f) => f.includes('type'))).toBe(true);
    });

    it('provides suggestions for improvement', () => {
      const signals = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.1,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 50,
        },
      });

      const conf = computeConfidence(signals);

      expect(conf.diagnostics.suggestions.length).toBeGreaterThan(0);
      expect(
        conf.diagnostics.suggestions.some(
          (s) => s.includes('type') || s.includes('documentation')
        )
      ).toBe(true);
    });

    it('tracks raw score before clamping', () => {
      const signals = createTestSignals();
      const conf = computeConfidence(signals);

      expect(typeof conf.diagnostics.rawScore).toBe('number');
      // Raw score might differ from overall due to clamping
    });
  });

  // ============================================================================
  // MONOTONICITY TESTS
  // ============================================================================

  describe('mathematical properties', () => {
    it('improving any signal never decreases confidence', () => {
      const base = createTestSignals();
      const baseConf = computeConfidence(base);

      // Improve structural
      const improvedStructural = createTestSignals({
        structural: {
          ...base.structural,
          typeAnnotationRatio: base.structural.typeAnnotationRatio + 0.2,
        },
      });
      const improvedStructuralConf = computeConfidence(improvedStructural);
      expect(improvedStructuralConf.overall).toBeGreaterThanOrEqual(baseConf.overall);

      // Improve semantic
      const improvedSemantic = createTestSignals({
        semantic: {
          ...base.semantic,
          purposeQuality: base.semantic.purposeQuality + 0.2,
        },
      });
      const improvedSemanticConf = computeConfidence(improvedSemantic);
      expect(improvedSemanticConf.overall).toBeGreaterThanOrEqual(baseConf.overall);

      // Improve historical
      const improvedHistorical = createTestSignals({
        historical: {
          ...base.historical,
          retrievalSuccessRate: 0.9,
          retrievalCount: 50,
        },
      });
      const improvedHistoricalConf = computeConfidence(improvedHistorical);
      expect(improvedHistoricalConf.overall).toBeGreaterThanOrEqual(baseConf.overall);
    });

    it('degrading signals reduces confidence', () => {
      const base = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.8,
          hasDocstring: true,
          docstringQuality: 0.7,
          isExported: true,
          hasPublicAPI: true,
          complexity: 'low',
          lineCount: 50,
        },
      });
      const baseConf = computeConfidence(base);

      // Degrade structural
      const degradedStructural = createTestSignals({
        structural: {
          typeAnnotationRatio: 0.2,
          hasDocstring: false,
          docstringQuality: 0,
          isExported: false,
          hasPublicAPI: false,
          complexity: 'high',
          lineCount: 500,
        },
      });
      const degradedConf = computeConfidence(degradedStructural);

      expect(degradedConf.overall).toBeLessThan(baseConf.overall);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('integration', () => {
    it('end-to-end: function → signals → confidence', () => {
      const fn = createTestFunction({
        signature: 'export function validateUser(user: User): ValidationResult',
        purpose: 'Validates user input data against schema rules and returns detailed validation results including field-level errors',
        accessCount: 25,
        validationCount: 10,
        outcomeHistory: { successes: 20, failures: 5 },
        lastAccessed: new Date(Date.now() - 2 * 86400000), // 2 days ago
        startLine: 10,
        endLine: 60, // 50 lines
      });

      const signals = extractSignalsFromFunction(fn);
      const conf = computeConfidence(signals);

      // Should have reasonably high confidence
      expect(conf.overall).toBeGreaterThan(0.5);
      expect(conf.overall).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(conf.overall).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);

      // Check that contributions make sense
      expect(conf.contributions.structuralContribution).toBeGreaterThan(0);
      expect(conf.contributions.semanticContribution).toBeGreaterThan(0);
      expect(conf.contributions.historicalContribution).toBeGreaterThan(0);
    });

    it('end-to-end: varied entities produce varied confidences', () => {
      const entities = [
        createTestFunction({
          signature: 'export function validateUser(user: User): ValidationResult',
          purpose: 'Comprehensive user validation with detailed error reporting',
          accessCount: 50,
          outcomeHistory: { successes: 45, failures: 5 },
          lastAccessed: new Date(),
        }),
        createTestFunction({
          signature: 'function helper(x)',
          purpose: 'does something',
          accessCount: 2,
          outcomeHistory: { successes: 1, failures: 1 },
          lastAccessed: new Date(Date.now() - 90 * 86400000),
        }),
        createTestFunction({
          signature: 'function process(data: any)',
          purpose: 'processes data',
          accessCount: 10,
          outcomeHistory: { successes: 5, failures: 5 },
          lastAccessed: new Date(Date.now() - 30 * 86400000),
        }),
      ];

      const confidences = entities
        .map((fn) => extractSignalsFromFunction(fn))
        .map(computeConfidence)
        .map((c) => c.overall);

      const stats = computeConfidenceStats(confidences);

      // Should have meaningful variance
      expect(stats.variance).toBeGreaterThan(0.01);
      expect(stats.max - stats.min).toBeGreaterThan(0.15);
    });
  });
});
