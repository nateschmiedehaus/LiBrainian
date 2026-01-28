/**
 * @fileoverview Tests for Recommendation Generation Primitive
 */

import { describe, it, expect } from 'vitest';
import {
  generateRecommendations,
  createGenerateRecommendations,
  type AnalysisResults,
} from '../generate_recommendations.js';
import type { ArchitectureAnalysisResult } from '../analyze_architecture.js';
import type { ConsistencyAnalysisResult } from '../analyze_consistency.js';
import type { CalibrationVerificationResult } from '../verify_calibration.js';

describe('generateRecommendations', () => {
  const mockArchitectureResult: ArchitectureAnalysisResult = {
    modules: [
      {
        path: '/test/src/core/processor.ts',
        name: 'processor',
        exportCount: 5,
        dependencyCount: 3,
        dependentCount: 2,
        layer: 'core',
        complexity: 50,
      },
    ],
    dependencies: [
      {
        from: '/test/src/api/handler.ts',
        to: '/test/src/core/processor.ts',
        type: 'import',
        confidence: 0.9,
        isViolation: false,
      },
    ],
    cycles: [
      {
        modules: ['/test/src/a.ts', '/test/src/b.ts'],
        length: 2,
        severity: 'high',
        suggestedBreakPoint: '/test/src/a.ts',
      },
    ],
    layerViolations: [
      {
        type: 'layer_violations',
        severity: 'high',
        location: '/test/src/storage/db.ts',
        description: 'Storage layer depends on API layer',
        suggestion: 'Extract interface or move shared code',
        affectedEntities: ['/test/src/storage/db.ts', '/test/src/api/handler.ts'],
      },
    ],
    couplingMetrics: {
      averageAfferentCoupling: 3,
      averageEfferentCoupling: 4,
      averageInstability: 0.57,
      highCouplingCount: 2,
      mostCoupled: [
        { module: '/test/src/core/processor.ts', afferent: 5, efferent: 8 },
      ],
    },
    duration: 1000,
    errors: [],
    suggestions: [
      {
        priority: 80,
        category: 'decoupling',
        title: 'Reduce coupling in processor.ts',
        description: 'Module has high coupling',
        affectedFiles: ['/test/src/core/processor.ts'],
        effort: 'moderate',
      },
    ],
  };

  const mockConsistencyResult: ConsistencyAnalysisResult = {
    codeTestMismatches: [
      {
        id: 'mismatch-1',
        type: 'behavior_test_evidence',
        severity: 'warning',
        claimed: 'Function returns array',
        actual: 'Function returns object',
        location: '/test/src/utils/helpers.ts',
        suggestedResolution: 'Update test or code',
      },
    ],
    codeDocMismatches: [
      {
        id: 'mismatch-2',
        type: 'doc_code_alignment',
        severity: 'info',
        claimed: '@param {string} data',
        actual: 'data: number',
        location: '/test/src/api/handler.ts',
        suggestedResolution: 'Update documentation',
      },
    ],
    unreferencedCode: [
      '/test/src/utils/deprecated.ts:oldFunction',
      '/test/src/utils/deprecated.ts:legacyHelper',
    ],
    staleDocs: ['/test/src/README.md'],
    overallScore: 0.75,
    phantomClaims: [],
    untestedClaims: [
      {
        claim: 'validateInput works correctly',
        entityId: 'fn-1',
        entityPath: '/test/src/utils/validation.ts',
        expectedTestPattern: '__tests__/validation.test.ts',
        searchedTestFiles: [],
      },
      {
        claim: 'processData handles edge cases',
        entityId: 'fn-2',
        entityPath: '/test/src/core/processor.ts',
        expectedTestPattern: '__tests__/processor.test.ts',
        searchedTestFiles: [],
      },
      {
        claim: 'formatOutput returns string',
        entityId: 'fn-3',
        entityPath: '/test/src/utils/formatter.ts',
        expectedTestPattern: '__tests__/formatter.test.ts',
        searchedTestFiles: [],
      },
      {
        claim: 'parseInput parses correctly',
        entityId: 'fn-4',
        entityPath: '/test/src/utils/parser.ts',
        expectedTestPattern: '__tests__/parser.test.ts',
        searchedTestFiles: [],
      },
      {
        claim: 'handleError logs errors',
        entityId: 'fn-5',
        entityPath: '/test/src/utils/errors.ts',
        expectedTestPattern: '__tests__/errors.test.ts',
        searchedTestFiles: [],
      },
      {
        claim: 'computeHash is deterministic',
        entityId: 'fn-6',
        entityPath: '/test/src/utils/hash.ts',
        expectedTestPattern: '__tests__/hash.test.ts',
        searchedTestFiles: [],
      },
    ],
    docDrift: [],
    duration: 500,
    errors: [],
  };

  const mockCalibrationResult: CalibrationVerificationResult = {
    ece: 0.12,
    mce: 0.25,
    brierScore: 0.18,
    isWellCalibrated: false,
    recommendations: [
      'ECE (0.120) exceeds target (0.050). Consider recalibrating.',
      'Overconfidence detected in 2 bins.',
    ],
    calibrationStatus: 'miscalibrated',
    reliabilityDiagram: {
      bins: [],
      perfectCalibrationLine: [[0, 0], [1, 1]],
    },
    sampleComplexityAnalysis: {
      currentSampleSize: 100,
      requiredSamplesForEpsilon: 500,
      currentEpsilon: 0.1,
      confidenceInterval: [0.02, 0.22],
      powerAnalysis: {
        currentPower: 0.6,
        detectableEffectSize: 0.2,
        samplesForPower80: 200,
      },
    },
    confidence: { score: 0.7, tier: 'medium', source: 'measured', sampleSize: 100 },
    duration: 200,
    errors: [],
  };

  it('returns result structure with all required fields', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
    });

    expect(result).toHaveProperty('recommendations');
    expect(result).toHaveProperty('prioritizedActions');
    expect(result).toHaveProperty('estimatedImpact');
    expect(result).toHaveProperty('roadmap');
    expect(result).toHaveProperty('dependencies');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(Array.isArray(result.prioritizedActions)).toBe(true);
    expect(typeof result.estimatedImpact).toBe('object');
  });

  it('generates recommendations from architecture analysis', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);

    // Should include cycle and violation recommendations
    const archRecs = result.recommendations.filter((r) => r.category === 'architecture');
    expect(archRecs.length).toBeGreaterThan(0);
  });

  it('generates recommendations from consistency analysis', async () => {
    const result = await generateRecommendations({
      consistency: mockConsistencyResult,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);

    // Should include correctness and maintainability recommendations
    const correctnessRecs = result.recommendations.filter((r) => r.category === 'correctness');
    const maintRecs = result.recommendations.filter((r) => r.category === 'maintainability');
    expect(correctnessRecs.length + maintRecs.length).toBeGreaterThan(0);
  });

  it('generates recommendations from calibration analysis', async () => {
    const result = await generateRecommendations({
      calibration: mockCalibrationResult,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);

    // Should include theoretical recommendations
    const theoreticalRecs = result.recommendations.filter((r) => r.category === 'theoretical');
    expect(theoreticalRecs.length).toBeGreaterThan(0);
  });

  it('combines recommendations from multiple analyses', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
      consistency: mockConsistencyResult,
      calibration: mockCalibrationResult,
    });

    // Should have recommendations from all sources
    const categories = new Set(result.recommendations.map((r) => r.category));
    expect(categories.size).toBeGreaterThan(1);
  });

  it('prioritizes recommendations correctly', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
      consistency: mockConsistencyResult,
    });

    // Recommendations should be sorted by priority (descending)
    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i - 1].priority).toBeGreaterThanOrEqual(
        result.recommendations[i].priority
      );
    }
  });

  it('generates prioritized actions', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
    });

    expect(result.prioritizedActions.length).toBeGreaterThan(0);

    for (const action of result.prioritizedActions) {
      expect(action).toHaveProperty('id');
      expect(action).toHaveProperty('title');
      expect(action).toHaveProperty('priority');
      expect(action).toHaveProperty('effort');
      expect(action).toHaveProperty('recommendationId');
    }
  });

  it('estimates impact correctly', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
      consistency: mockConsistencyResult,
    });

    expect(result.estimatedImpact).toHaveProperty('qualityImprovement');
    expect(result.estimatedImpact).toHaveProperty('debtReduction');
    expect(result.estimatedImpact).toHaveProperty('maintainabilityImprovement');
    expect(result.estimatedImpact).toHaveProperty('riskReduction');
    expect(result.estimatedImpact).toHaveProperty('totalEffortHours');
    expect(result.estimatedImpact).toHaveProperty('confidence');

    // Values should be in valid range
    expect(result.estimatedImpact.qualityImprovement).toBeGreaterThanOrEqual(0);
    expect(result.estimatedImpact.qualityImprovement).toBeLessThanOrEqual(1);
    expect(result.estimatedImpact.totalEffortHours.min).toBeLessThanOrEqual(
      result.estimatedImpact.totalEffortHours.max
    );
  });

  it('generates improvement roadmap', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
      consistency: mockConsistencyResult,
    });

    expect(result.roadmap).toHaveProperty('phases');
    expect(result.roadmap).toHaveProperty('totalEstimatedEffort');
    expect(result.roadmap).toHaveProperty('criticalPath');

    expect(Array.isArray(result.roadmap.phases)).toBe(true);
    expect(Array.isArray(result.roadmap.criticalPath)).toBe(true);
  });

  it('identifies dependencies between recommendations', async () => {
    const result = await generateRecommendations({
      architecture: mockArchitectureResult,
    });

    // Dependencies array should exist
    expect(Array.isArray(result.dependencies)).toBe(true);

    // Each dependency should have correct structure
    for (const dep of result.dependencies) {
      expect(dep).toHaveProperty('from');
      expect(dep).toHaveProperty('to');
      expect(dep).toHaveProperty('type');
      expect(['blocks', 'enables', 'conflicts_with', 'related_to']).toContain(dep.type);
    }
  });

  it('respects maxRecommendations option', async () => {
    const maxRecommendations = 3;
    const result = await generateRecommendations(
      {
        architecture: mockArchitectureResult,
        consistency: mockConsistencyResult,
      },
      { maxRecommendations }
    );

    expect(result.recommendations.length).toBeLessThanOrEqual(maxRecommendations);
  });

  it('filters by category when specified', async () => {
    const result = await generateRecommendations(
      {
        architecture: mockArchitectureResult,
        consistency: mockConsistencyResult,
      },
      { categories: ['architecture'] }
    );

    // All recommendations should be architecture
    expect(result.recommendations.every((r) => r.category === 'architecture')).toBe(true);
  });

  it('filters by minimum severity', async () => {
    const result = await generateRecommendations(
      {
        architecture: mockArchitectureResult,
        consistency: mockConsistencyResult,
      },
      { minSeverity: 'high' }
    );

    // All recommendations should be high or critical
    expect(result.recommendations.every((r) =>
      r.severity === 'high' || r.severity === 'critical'
    )).toBe(true);
  });

  it('applies custom prioritization weights', async () => {
    const severityFocusedResult = await generateRecommendations(
      { architecture: mockArchitectureResult },
      { weights: { severity: 0.9, effort: 0.05, impact: 0.025, riskReduction: 0.025 } }
    );

    const effortFocusedResult = await generateRecommendations(
      { architecture: mockArchitectureResult },
      { weights: { severity: 0.1, effort: 0.7, impact: 0.1, riskReduction: 0.1 } }
    );

    // Both results should have recommendations
    expect(severityFocusedResult.recommendations.length).toBeGreaterThan(0);
    expect(effortFocusedResult.recommendations.length).toBeGreaterThan(0);

    // The priorities should be calculated differently based on weights
    // Even if the order is the same, the priority scores should differ
    if (severityFocusedResult.recommendations.length > 1 && effortFocusedResult.recommendations.length > 1) {
      // At minimum, the priority calculations use different weights
      expect(severityFocusedResult.recommendations[0].priority).not.toBe(
        effortFocusedResult.recommendations[0].priority
      );
    }
  });

  describe('createGenerateRecommendations', () => {
    it('creates a bound generation function with default options', async () => {
      const boundGenerate = createGenerateRecommendations({
        maxRecommendations: 5,
        minSeverity: 'medium',
      });

      const result = await boundGenerate({
        architecture: mockArchitectureResult,
      });

      expect(result.recommendations.length).toBeLessThanOrEqual(5);
      expect(result.recommendations.every((r) =>
        r.severity !== 'low'
      )).toBe(true);
    });
  });

  describe('roadmap generation', () => {
    it('groups recommendations into phases by severity', async () => {
      const result = await generateRecommendations({
        architecture: mockArchitectureResult,
        consistency: mockConsistencyResult,
      });

      // Phases should be ordered: Critical -> High -> Medium -> Low
      const phaseNames = result.roadmap.phases.map((p) => p.name);
      if (phaseNames.length > 0) {
        // First phase should be critical or high priority
        expect(phaseNames[0]).toMatch(/Critical|High/);
      }
    });

    it('includes dependencies between phases', async () => {
      const result = await generateRecommendations({
        architecture: mockArchitectureResult,
        consistency: mockConsistencyResult,
      });

      // Later phases should depend on earlier phases
      for (let i = 1; i < result.roadmap.phases.length; i++) {
        const phase = result.roadmap.phases[i];
        if (phase.dependencies.length > 0) {
          // Dependencies should reference earlier phases
          expect(phase.dependencies.some((d) =>
            result.roadmap.phases.slice(0, i).some((p) => p.name === d)
          )).toBe(true);
        }
      }
    });
  });

  describe('recommendation structure', () => {
    it('includes all required fields in recommendations', async () => {
      const result = await generateRecommendations({
        architecture: mockArchitectureResult,
      });

      for (const rec of result.recommendations) {
        expect(rec).toHaveProperty('id');
        expect(rec).toHaveProperty('title');
        expect(rec).toHaveProperty('description');
        expect(rec).toHaveProperty('category');
        expect(rec).toHaveProperty('priority');
        expect(rec).toHaveProperty('severity');
        expect(rec).toHaveProperty('effort');
        expect(rec).toHaveProperty('impact');
        expect(rec).toHaveProperty('affectedFiles');

        // Effort should have proper structure
        expect(rec.effort).toHaveProperty('loc');
        expect(rec.effort).toHaveProperty('hours');
        expect(rec.effort).toHaveProperty('complexity');
        expect(rec.effort).toHaveProperty('confidence');
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty analysis results', async () => {
      const result = await generateRecommendations({});

      expect(result.recommendations).toEqual([]);
      expect(result.prioritizedActions).toEqual([]);
      expect(result.estimatedImpact.qualityImprovement).toBe(0);
    });

    it('handles analysis with no issues', async () => {
      const cleanArchitecture: ArchitectureAnalysisResult = {
        ...mockArchitectureResult,
        cycles: [],
        layerViolations: [],
        suggestions: [],
        couplingMetrics: { ...mockArchitectureResult.couplingMetrics, highCouplingCount: 0 },
      };

      const result = await generateRecommendations({
        architecture: cleanArchitecture,
      });

      // May still have some recommendations but fewer
      expect(result.recommendations.length).toBeLessThan(5);
    });
  });
});
