/**
 * @fileoverview Tests for Bayesian defeat reduction (WU-THIMPL-202)
 *
 * Tests cover:
 * - Linear defeat reduction (baseline)
 * - Bayesian defeat reduction with beta-binomial update
 * - Multiple defeaters accumulation
 * - Edge cases and boundary conditions
 */

import { describe, it, expect } from 'vitest';
import {
  computeDefeatedStrength,
  computeMultipleDefeatedStrength,
  DEFAULT_DEFEAT_REDUCTION_OPTIONS,
  type DefeatReductionOptions,
} from '../defeaters.js';
import { createDefeater, createClaimId } from '../types.js';

describe('Bayesian Defeat Reduction (WU-THIMPL-202)', () => {
  // Helper to create a test defeater with given reduction
  const makeDefeater = (reduction: number) =>
    createDefeater({
      type: 'code_change',
      description: 'Test defeater',
      severity: 'partial',
      affectedClaimIds: [createClaimId('test-claim')],
      confidenceReduction: reduction,
      autoResolvable: true,
    });

  describe('computeDefeatedStrength - Linear Method', () => {
    it('should reduce strength by defeater reduction amount', () => {
      const defeater = makeDefeater(0.3);
      const result = computeDefeatedStrength(0.8, defeater, { method: 'linear' });
      expect(result).toBeCloseTo(0.5, 5);
    });

    it('should floor at 0 for large reductions', () => {
      const defeater = makeDefeater(1.0);
      const result = computeDefeatedStrength(0.5, defeater, { method: 'linear' });
      expect(result).toBe(0);
    });

    it('should handle zero reduction', () => {
      const defeater = makeDefeater(0);
      const result = computeDefeatedStrength(0.8, defeater, { method: 'linear' });
      expect(result).toBeCloseTo(0.8, 5);
    });

    it('should handle zero original strength', () => {
      const defeater = makeDefeater(0.3);
      const result = computeDefeatedStrength(0, defeater, { method: 'linear' });
      expect(result).toBe(0);
    });

    it('should be the default method', () => {
      expect(DEFAULT_DEFEAT_REDUCTION_OPTIONS.method).toBe('linear');
    });
  });

  describe('computeDefeatedStrength - Bayesian Method', () => {
    const bayesianOpts: DefeatReductionOptions = {
      method: 'bayesian',
      priorStrength: 0.5,
      priorSampleSize: 2,
    };

    it('should compute posterior mean from beta-binomial update', () => {
      const defeater = makeDefeater(0.3);
      const result = computeDefeatedStrength(0.8, defeater, bayesianOpts);

      // With prior Beta(1, 1) (uniform), and evidence 0.8 success, 0.3 failure:
      // Posterior: Beta(1 + 0.8, 1 + 0.3) = Beta(1.8, 1.3)
      // Mean = 1.8 / (1.8 + 1.3) = 1.8 / 3.1 ≈ 0.5806
      expect(result).toBeCloseTo(0.5806, 3);
    });

    it('should be more resistant to defeat with strong prior', () => {
      const defeater = makeDefeater(0.5);

      // Weak prior (default: priorSampleSize = 2)
      const weakPrior = computeDefeatedStrength(0.8, defeater, {
        method: 'bayesian',
        priorStrength: 0.5,
        priorSampleSize: 2,
      });

      // Strong prior (priorSampleSize = 10)
      const strongPrior = computeDefeatedStrength(0.8, defeater, {
        method: 'bayesian',
        priorStrength: 0.8, // High prior belief
        priorSampleSize: 10,
      });

      // Strong prior should result in higher post-defeat strength
      expect(strongPrior).toBeGreaterThan(weakPrior);
    });

    it('should pull toward prior strength', () => {
      const defeater = makeDefeater(0.2);

      // With high prior strength
      const highPrior = computeDefeatedStrength(0.5, defeater, {
        method: 'bayesian',
        priorStrength: 0.9,
        priorSampleSize: 5,
      });

      // With low prior strength
      const lowPrior = computeDefeatedStrength(0.5, defeater, {
        method: 'bayesian',
        priorStrength: 0.1,
        priorSampleSize: 5,
      });

      expect(highPrior).toBeGreaterThan(lowPrior);
    });

    it('should never go below 0 or above 1', () => {
      const strongDefeater = makeDefeater(1.0);

      const result = computeDefeatedStrength(0.1, strongDefeater, {
        method: 'bayesian',
        priorStrength: 0.1,
        priorSampleSize: 1,
      });

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should handle edge case: zero original strength', () => {
      const defeater = makeDefeater(0.5);
      const result = computeDefeatedStrength(0, defeater, bayesianOpts);

      // Should still return valid probability from prior
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should handle edge case: zero reduction', () => {
      const defeater = makeDefeater(0);
      const result = computeDefeatedStrength(0.8, defeater, bayesianOpts);

      // Should be close to evidence strength weighted by prior
      expect(result).toBeGreaterThan(0.5);
    });

    it('should give different results than linear for same inputs', () => {
      const defeater = makeDefeater(0.3);
      const linear = computeDefeatedStrength(0.8, defeater, { method: 'linear' });
      const bayesian = computeDefeatedStrength(0.8, defeater, bayesianOpts);

      // Linear: 0.8 - 0.3 = 0.5
      expect(linear).toBeCloseTo(0.5, 5);
      // Bayesian: posterior mean (different)
      expect(bayesian).not.toBeCloseTo(0.5, 2);
    });
  });

  describe('computeMultipleDefeatedStrength', () => {
    it('should apply multiple defeaters sequentially (linear)', () => {
      const defeaters = [
        makeDefeater(0.2),
        makeDefeater(0.2),
        makeDefeater(0.2),
      ];

      const result = computeMultipleDefeatedStrength(0.9, defeaters, {
        method: 'linear',
      });

      // 0.9 - 0.2 - 0.2 - 0.2 = 0.3
      expect(result).toBeCloseTo(0.3, 5);
    });

    it('should accumulate defeat evidence (bayesian)', () => {
      const defeaters = [
        makeDefeater(0.2),
        makeDefeater(0.2),
      ];

      const bayesianOpts: DefeatReductionOptions = {
        method: 'bayesian',
        priorStrength: 0.5,
        priorSampleSize: 2,
      };

      const result = computeMultipleDefeatedStrength(0.8, defeaters, bayesianOpts);

      // Combined reduction = 0.4
      const singleDefeaterResult = computeDefeatedStrength(
        0.8,
        makeDefeater(0.4),
        bayesianOpts
      );

      expect(result).toBeCloseTo(singleDefeaterResult, 5);
    });

    it('should return original strength for empty defeater array', () => {
      const result = computeMultipleDefeatedStrength(0.7, [], { method: 'linear' });
      expect(result).toBeCloseTo(0.7, 5);

      const bayesianResult = computeMultipleDefeatedStrength(0.7, [], {
        method: 'bayesian',
      });
      expect(bayesianResult).toBeCloseTo(0.7, 5);
    });

    it('should cap combined reduction at 1 for bayesian', () => {
      const defeaters = [
        makeDefeater(0.6),
        makeDefeater(0.6),
        makeDefeater(0.6),
      ];

      const result = computeMultipleDefeatedStrength(0.8, defeaters, {
        method: 'bayesian',
        priorStrength: 0.5,
        priorSampleSize: 2,
      });

      // Combined reduction would be 1.8, but capped at 1.0
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe('Use Case Documentation', () => {
    it('documents when to use linear vs bayesian', () => {
      const defeater = makeDefeater(0.3);
      const originalStrength = 0.8;

      // Linear: Use for quick assessments, well-calibrated defeaters
      const linear = computeDefeatedStrength(originalStrength, defeater, {
        method: 'linear',
      });

      // Bayesian: Use when combining multiple defeaters or when
      // prior beliefs matter
      const bayesian = computeDefeatedStrength(originalStrength, defeater, {
        method: 'bayesian',
        priorStrength: 0.7,    // We have strong prior belief in evidence
        priorSampleSize: 5,   // Moderate confidence in that prior
      });

      // Both are valid approaches with different characteristics
      expect(linear).toBeGreaterThanOrEqual(0);
      expect(bayesian).toBeGreaterThanOrEqual(0);

      // The bayesian result depends on prior configuration
      // With a high prior, it resists defeat more
      expect(bayesian).toBeGreaterThan(linear);
    });
  });
});
