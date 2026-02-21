/**
 * @fileoverview Tests for Continuous Fitness Computation
 *
 * These tests verify the mathematical properties and behavioral correctness
 * of the harmonic mean fitness computation with floors.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeContinuousFitness,
  extractDimensionsFromVector,
  computeContinuousOverallScore,
  validateWeights,
  validateMonotonicity,
  DIMENSION_FLOORS,
  DIMENSION_WEIGHTS,
  type FitnessDimensions,
} from '../continuous_fitness.js';
import type { FitnessVector } from '../types.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function randomFitnessVector(): FitnessDimensions {
  return {
    correctness: Math.random(),
    retrieval: Math.random(),
    epistemic: Math.random(),
    operational: Math.random(),
    calibration: Math.random(),
    coverage: Math.random(),
  };
}

function randomDimension(): keyof FitnessDimensions {
  const dims: (keyof FitnessDimensions)[] = [
    'correctness', 'retrieval', 'epistemic', 'operational', 'calibration', 'coverage'
  ];
  return dims[Math.floor(Math.random() * dims.length)];
}

function createTestFitnessVector(overrides: Partial<FitnessVector> = {}): FitnessVector {
  return {
    correctness: {
      tier0PassRate: 0.5,
      tier1PassRate: 0.5,
      tier2PassRate: 0.5,
      schemaValid: true,
      deterministicVerified: true,
    },
    retrievalQuality: {
      recallAt5: 0.5,
      recallAt10: 0.5,
      precisionAt5: 0.5,
      nDCG: 0.5,
      mrr: 0.5,
    },
    epistemicQuality: {
      evidenceCoverage: 0.5,
      defeaterCorrectness: 0.5,
      calibrationError: 0.15,
      claimVerificationRate: 0.5,
    },
    operationalQuality: {
      queryLatencyP50Ms: 200,
      queryLatencyP99Ms: 500,
      bootstrapTimeSeconds: 60,
      cacheHitRate: 0.5,
      freshnessLagSeconds: 30,
    },
    securityRobustness: {
      injectionResistance: 1.0,
      provenanceLabeling: 1.0,
      failClosedBehavior: true,
    },
    costEfficiency: {
      tokenUsage: 10000,
      embeddingCalls: 100,
      providerCalls: 5,
      recoveryBudgetCompliance: true,
    },
    agenticUtility: {
      taskCompletionLift: 0.5,
      timeToSolutionReduction: 0.5,
      contextUsageRate: 0.5,
      codeQualityLift: 0.5,
      decisionAccuracy: 0.5,
      agentSatisfactionScore: 0.5,
      missingContextRate: 0.2,
      irrelevantContextRate: 0.2,
    },
    overall: 0,
    ...overrides,
  };
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('ContinuousFitness', () => {
  describe('configuration validation', () => {
    it('dimension weights sum to 1.0', () => {
      expect(validateWeights()).toBe(true);
      const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    });

    it('all dimension floors are positive', () => {
      for (const [dim, floor] of Object.entries(DIMENSION_FLOORS)) {
        expect(floor).toBeGreaterThan(0);
        expect(floor).toBeLessThan(0.5);
      }
    });
  });

  describe('never returns zero', () => {
    it('returns positive fitness when all dimensions are zero', () => {
      const result = computeContinuousFitness({
        correctness: 0,
        retrieval: 0,
        epistemic: 0,
        operational: 0,
        calibration: 0,
        coverage: 0,
      });

      expect(result.overall).toBeGreaterThanOrEqual(0.05);
      expect(result.overall).toBeLessThanOrEqual(0.15);
      expect(result.metadata.floorsApplied.length).toBe(6);
    });

    it('returns positive fitness when single dimension is zero', () => {
      const result = computeContinuousFitness({
        correctness: 0.8,
        retrieval: 0.6,
        epistemic: 0,
        operational: 0.5,
        calibration: 0.7,
        coverage: 0.4,
      });

      expect(result.overall).toBeGreaterThan(0.2);
      expect(result.metadata.floorsApplied).toContain('epistemic');
    });

    it('handles NaN and undefined gracefully', () => {
      const result = computeContinuousFitness({
        correctness: NaN,
        retrieval: undefined as unknown as number,
        epistemic: -0.5,
        operational: Infinity,
        calibration: 0.5,
        coverage: 0.5,
      });

      expect(Number.isFinite(result.overall)).toBe(true);
      expect(result.overall).toBeGreaterThan(0);
    });
  });

  describe('gradient signal', () => {
    it('small improvements yield proportional fitness increase', () => {
      const baseline = computeContinuousFitness({
        correctness: 0.3,
        retrieval: 0.3,
        epistemic: 0.3,
        operational: 0.3,
        calibration: 0.3,
        coverage: 0.3,
      });
      const improved = computeContinuousFitness({
        correctness: 0.35, // +0.05
        retrieval: 0.3,
        epistemic: 0.3,
        operational: 0.3,
        calibration: 0.3,
        coverage: 0.3,
      });

      expect(improved.overall).toBeGreaterThan(baseline.overall);
      expect(improved.overall - baseline.overall).toBeGreaterThan(0.001); // Measurable
    });

    it('dimension contributions are weighted correctly', () => {
      // Correctness has highest weight (0.30), coverage has lowest (0.10)
      const highCorrectness = computeContinuousFitness({
        correctness: 0.9,
        retrieval: 0.3,
        epistemic: 0.3,
        operational: 0.3,
        calibration: 0.3,
        coverage: 0.3,
      });
      const highCoverage = computeContinuousFitness({
        correctness: 0.3,
        retrieval: 0.3,
        epistemic: 0.3,
        operational: 0.3,
        calibration: 0.3,
        coverage: 0.9,
      });

      expect(highCorrectness.overall).toBeGreaterThan(highCoverage.overall);
    });

    it('improvement in any dimension improves overall', () => {
      const base: FitnessDimensions = {
        correctness: 0.4,
        retrieval: 0.4,
        epistemic: 0.4,
        operational: 0.4,
        calibration: 0.4,
        coverage: 0.4,
      };
      const baseFitness = computeContinuousFitness(base).overall;

      const dims = Object.keys(base) as (keyof FitnessDimensions)[];
      for (const dim of dims) {
        const improved = { ...base, [dim]: 0.6 };
        const improvedFitness = computeContinuousFitness(improved).overall;
        expect(improvedFitness).toBeGreaterThan(baseFitness);
      }
    });
  });

  describe('bounds enforcement', () => {
    it('floors are respected for each dimension', () => {
      const result = computeContinuousFitness({
        correctness: 0,
        retrieval: 0,
        epistemic: 0,
        operational: 0,
        calibration: 0,
        coverage: 0,
      });

      expect(result.dimensions.correctness).toBeGreaterThanOrEqual(DIMENSION_FLOORS.correctness);
      expect(result.dimensions.retrieval).toBeGreaterThanOrEqual(DIMENSION_FLOORS.retrieval);
      expect(result.dimensions.epistemic).toBeGreaterThanOrEqual(DIMENSION_FLOORS.epistemic);
      expect(result.dimensions.operational).toBeGreaterThanOrEqual(DIMENSION_FLOORS.operational);
      expect(result.dimensions.calibration).toBeGreaterThanOrEqual(DIMENSION_FLOORS.calibration);
      expect(result.dimensions.coverage).toBeGreaterThanOrEqual(DIMENSION_FLOORS.coverage);
    });

    it('values above floors are preserved', () => {
      const result = computeContinuousFitness({
        correctness: 0.7,
        retrieval: 0.6,
        epistemic: 0.5,
        operational: 0.8,
        calibration: 0.9,
        coverage: 0.4,
      });

      expect(result.dimensions.correctness).toBeCloseTo(0.7, 4);
      expect(result.dimensions.retrieval).toBeCloseTo(0.6, 4);
      expect(result.dimensions.epistemic).toBeCloseTo(0.5, 4);
      expect(result.dimensions.operational).toBeCloseTo(0.8, 4);
      expect(result.dimensions.calibration).toBeCloseTo(0.9, 4);
      expect(result.dimensions.coverage).toBeCloseTo(0.4, 4);
      expect(result.metadata.floorsApplied.length).toBe(0);
    });

    it('values capped at 1.0', () => {
      const result = computeContinuousFitness({
        correctness: 1.5,
        retrieval: 2.0,
        epistemic: 1.1,
        operational: 1.0,
        calibration: 0.9,
        coverage: 0.8,
      });

      expect(result.dimensions.correctness).toBeLessThanOrEqual(1.0);
      expect(result.dimensions.retrieval).toBeLessThanOrEqual(1.0);
      expect(result.dimensions.epistemic).toBeLessThanOrEqual(1.0);
    });

    it('perfect scores yield near-1.0 fitness', () => {
      const result = computeContinuousFitness({
        correctness: 1,
        retrieval: 1,
        epistemic: 1,
        operational: 1,
        calibration: 1,
        coverage: 1,
      });

      expect(result.overall).toBeGreaterThanOrEqual(0.95);
      expect(result.overall).toBeLessThanOrEqual(1.0);
    });
  });

  describe('mathematical properties', () => {
    it('is monotonic: improving any dimension never decreases overall', () => {
      for (let i = 0; i < 100; i++) {
        const base = randomFitnessVector();
        const dimToImprove = randomDimension();
        const improved = {
          ...base,
          [dimToImprove]: Math.min(1, base[dimToImprove] + 0.1),
        };

        const baseFitness = computeContinuousFitness(base).overall;
        const improvedFitness = computeContinuousFitness(improved).overall;

        expect(improvedFitness).toBeGreaterThanOrEqual(baseFitness - 0.0001);
      }
    });

    it('passes validateMonotonicity helper', () => {
      for (let i = 0; i < 50; i++) {
        const base = randomFitnessVector();
        const dimToImprove = randomDimension();
        const improved = {
          ...base,
          [dimToImprove]: Math.min(1, base[dimToImprove] + 0.1),
        };

        expect(validateMonotonicity(base, improved)).toBe(true);
      }
    });

    it('is continuous: small changes yield small deltas', () => {
      const base: FitnessDimensions = {
        correctness: 0.5,
        retrieval: 0.5,
        epistemic: 0.5,
        operational: 0.5,
        calibration: 0.5,
        coverage: 0.5,
      };
      const baseFitness = computeContinuousFitness(base).overall;

      // Small perturbation
      const perturbed: FitnessDimensions = {
        correctness: 0.501,
        retrieval: 0.5,
        epistemic: 0.5,
        operational: 0.5,
        calibration: 0.5,
        coverage: 0.5,
      };
      const perturbedFitness = computeContinuousFitness(perturbed).overall;

      // Delta should be small (continuity)
      const delta = Math.abs(perturbedFitness - baseFitness);
      expect(delta).toBeLessThan(0.01);
    });

    it('harmonic mean penalizes low values appropriately', () => {
      // Harmonic mean is more sensitive to low values than arithmetic mean
      const balanced = computeContinuousFitness({
        correctness: 0.5,
        retrieval: 0.5,
        epistemic: 0.5,
        operational: 0.5,
        calibration: 0.5,
        coverage: 0.5,
      });

      const unbalanced = computeContinuousFitness({
        correctness: 0.9,
        retrieval: 0.9,
        epistemic: 0.1,
        operational: 0.5,
        calibration: 0.5,
        coverage: 0.5,
      });

      // Unbalanced should be lower due to harmonic mean's sensitivity to low values
      expect(unbalanced.overall).toBeLessThan(balanced.overall);
    });
  });

  describe('metadata and tracking', () => {
    it('tracks which floors were applied', () => {
      const result = computeContinuousFitness({
        correctness: 0.05, // Below floor
        retrieval: 0.02,   // Below floor
        epistemic: 0.5,    // Above floor
        operational: 0.5,  // Above floor
        calibration: 0.5,  // Above floor
        coverage: 0.01,    // Below floor
      });

      expect(result.metadata.floorsApplied).toContain('correctness');
      expect(result.metadata.floorsApplied).toContain('retrieval');
      expect(result.metadata.floorsApplied).toContain('coverage');
      expect(result.metadata.floorsApplied).not.toContain('epistemic');
      expect(result.metadata.floorsApplied).not.toContain('operational');
      expect(result.metadata.floorsApplied).not.toContain('calibration');
    });

    it('preserves raw inputs in metadata', () => {
      const input: FitnessDimensions = {
        correctness: 0.1,
        retrieval: 0.2,
        epistemic: 0.3,
        operational: 0.4,
        calibration: 0.5,
        coverage: 0.6,
      };
      const result = computeContinuousFitness(input);

      expect(result.metadata.rawInputs.correctness).toBe(0.1);
      expect(result.metadata.rawInputs.retrieval).toBe(0.2);
      expect(result.metadata.rawInputs.epistemic).toBe(0.3);
    });

    it('indicates method used', () => {
      const result = computeContinuousFitness({
        correctness: 0.5,
        retrieval: 0.5,
        epistemic: 0.5,
        operational: 0.5,
        calibration: 0.5,
        coverage: 0.5,
      });

      expect(result.metadata.method).toBe('weighted_harmonic_mean');
    });
  });

  describe('integration with FitnessVector', () => {
    it('extracts dimensions from FitnessVector correctly', () => {
      const vector = createTestFitnessVector({
        correctness: {
          tier0PassRate: 0.8,
          tier1PassRate: 0.8,
          tier2PassRate: 0.5,
          schemaValid: true,
          deterministicVerified: true,
        },
      });

      const dims = extractDimensionsFromVector(vector);

      // sqrt(0.8 * 0.8) = 0.8
      expect(dims.correctness).toBeCloseTo(0.8, 2);
    });

    it('computeContinuousOverallScore works with FitnessVector', () => {
      const vector = createTestFitnessVector();
      const score = computeContinuousOverallScore(vector);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('handles zero FitnessVector gracefully', () => {
      const zeroVector = createTestFitnessVector({
        correctness: {
          tier0PassRate: 0,
          tier1PassRate: 0,
          tier2PassRate: 0,
          schemaValid: false,
          deterministicVerified: false,
        },
        retrievalQuality: {
          recallAt5: 0,
          recallAt10: 0,
          precisionAt5: 0,
          nDCG: 0,
          mrr: 0,
        },
        epistemicQuality: {
          evidenceCoverage: 0,
          defeaterCorrectness: 0,
          calibrationError: 1, // Max error
          claimVerificationRate: 0,
        },
      });

      const score = computeContinuousOverallScore(zeroVector);

      // Should still be positive due to floors
      expect(score).toBeGreaterThan(0);
      expect(score).toBeGreaterThanOrEqual(0.05);
    });
  });

  describe('comparison with old geometric mean', () => {
    it('never collapses to zero unlike geometric mean', () => {
      // Old geometric mean: Math.pow(0 * 0.5 * 0.5 * 0.5 * 0.5 * 0.5, 1/6) = 0
      // New harmonic mean with floors: > 0

      const result = computeContinuousFitness({
        correctness: 0, // Would cause geometric mean to collapse
        retrieval: 0.5,
        epistemic: 0.5,
        operational: 0.5,
        calibration: 0.5,
        coverage: 0.5,
      });

      expect(result.overall).toBeGreaterThan(0);
      expect(result.overall).toBeGreaterThan(0.1); // Significant positive value
    });

    it('provides gradient signal for broken systems', () => {
      const broken1 = computeContinuousFitness({
        correctness: 0,
        retrieval: 0,
        epistemic: 0.1,
        operational: 0,
        calibration: 0,
        coverage: 0,
      });

      const broken2 = computeContinuousFitness({
        correctness: 0,
        retrieval: 0,
        epistemic: 0.2, // Slight improvement
        operational: 0,
        calibration: 0,
        coverage: 0,
      });

      // Even broken systems can show improvement
      expect(broken2.overall).toBeGreaterThan(broken1.overall);
    });
  });
});
