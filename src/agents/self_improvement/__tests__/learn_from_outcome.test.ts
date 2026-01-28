/**
 * @fileoverview Tests for Learn From Outcome Primitive
 */

import { describe, it, expect } from 'vitest';
import {
  learnFromOutcome,
  createLearnFromOutcome,
  type Prediction,
  type Outcome,
  type PredictionContext,
} from '../learn_from_outcome.js';

describe('learnFromOutcome', () => {
  const mockPrediction: Prediction = {
    id: 'pred-1',
    claim: 'Function will return valid JSON',
    predictedOutcome: true,
    statedConfidence: {
      score: 0.85,
      tier: 'high',
      source: 'estimated',
    },
    timestamp: new Date('2024-01-15'),
    context: 'JSON parsing validation',
    entityId: 'entity-1',
    tags: ['parsing', 'validation'],
  };

  const mockCorrectOutcome: Outcome = {
    predictionId: 'pred-1',
    actualValue: true,
    wasCorrect: true,
    verificationMethod: 'automated',
    timestamp: new Date('2024-01-16'),
  };

  const mockIncorrectOutcome: Outcome = {
    predictionId: 'pred-1',
    actualValue: false,
    wasCorrect: false,
    verificationMethod: 'automated',
    timestamp: new Date('2024-01-16'),
    notes: 'Function threw an error',
  };

  const mockContext: PredictionContext = {
    domain: 'parsing',
    complexity: 'simple',
    features: {
      inputType: 'string',
      maxLength: 1000,
    },
    priorSimilarPredictions: 10,
    historicalAccuracy: 0.9,
  };

  it('returns result structure with all required fields', async () => {
    const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

    expect(result).toHaveProperty('outcomesProcessed');
    expect(result).toHaveProperty('calibrationUpdate');
    expect(result).toHaveProperty('knowledgeUpdates');
    expect(result).toHaveProperty('confidenceAdjustments');
    expect(result).toHaveProperty('patternsExtracted');
    expect(result).toHaveProperty('newDefeaters');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(result.outcomesProcessed).toBe(1);
    expect(typeof result.duration).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  describe('calibration update', () => {
    it('updates calibration for correct prediction', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

      expect(result.calibrationUpdate).toHaveProperty('previousECE');
      expect(result.calibrationUpdate).toHaveProperty('newECE');
      expect(result.calibrationUpdate).toHaveProperty('samplesAdded');
      expect(result.calibrationUpdate).toHaveProperty('binUpdates');
      expect(result.calibrationUpdate).toHaveProperty('calibrationImproved');

      expect(result.calibrationUpdate.samplesAdded).toBe(1);
      expect(result.calibrationUpdate.binUpdates.length).toBeGreaterThan(0);
    });

    it('updates calibration for incorrect prediction', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      expect(result.calibrationUpdate.samplesAdded).toBe(1);
      expect(result.calibrationUpdate.binUpdates.length).toBeGreaterThan(0);
    });

    it('bin updates have correct structure', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

      for (const binUpdate of result.calibrationUpdate.binUpdates) {
        expect(binUpdate).toHaveProperty('bin');
        expect(binUpdate).toHaveProperty('binCenter');
        expect(binUpdate).toHaveProperty('previousFrequency');
        expect(binUpdate).toHaveProperty('newFrequency');
        expect(binUpdate).toHaveProperty('previousSamples');
        expect(binUpdate).toHaveProperty('newSamples');
        expect(binUpdate.bin).toBeGreaterThanOrEqual(0);
        expect(binUpdate.bin).toBeLessThan(10);
      }
    });

    it('can skip calibration update', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext, {
        updateCalibration: false,
      });

      expect(result.calibrationUpdate.samplesAdded).toBe(0);
      expect(result.calibrationUpdate.binUpdates.length).toBe(0);
    });
  });

  describe('confidence adjustment', () => {
    it('increases confidence for correct predictions', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

      const adjustment = result.confidenceAdjustments.find(
        (a) => a.entityId === mockPrediction.entityId
      );

      if (adjustment) {
        expect(adjustment.adjusted.score).toBeGreaterThanOrEqual(adjustment.previous.score);
      }
    });

    it('decreases confidence for incorrect predictions', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      const adjustment = result.confidenceAdjustments.find(
        (a) => a.entityId === mockPrediction.entityId
      );

      expect(adjustment).toBeDefined();
      if (adjustment) {
        expect(adjustment.adjusted.score).toBeLessThan(adjustment.previous.score);
        expect(adjustment.reason).toContain('incorrect');
      }
    });

    it('each adjustment has required structure', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

      for (const adjustment of result.confidenceAdjustments) {
        expect(adjustment).toHaveProperty('entityId');
        expect(adjustment).toHaveProperty('previous');
        expect(adjustment).toHaveProperty('adjusted');
        expect(adjustment).toHaveProperty('reason');
        expect(adjustment).toHaveProperty('adjustmentFactor');
      }
    });

    it('respects adjustment factor option', async () => {
      const smallFactor = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext, {
        adjustmentFactor: 0.05,
      });

      const largeFactor = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext, {
        adjustmentFactor: 0.2,
      });

      const smallAdj = smallFactor.confidenceAdjustments[0];
      const largeAdj = largeFactor.confidenceAdjustments[0];

      // Larger adjustment factor should result in bigger change
      const smallDelta = Math.abs(smallAdj.adjusted.score - smallAdj.previous.score);
      const largeDelta = Math.abs(largeAdj.adjusted.score - largeAdj.previous.score);

      expect(largeDelta).toBeGreaterThan(smallDelta);
    });

    it('applies complexity penalty for incorrect predictions in complex contexts', async () => {
      const complexContext: PredictionContext = {
        ...mockContext,
        complexity: 'complex',
      };

      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, complexContext);

      const adjustment = result.confidenceAdjustments[0];
      expect(adjustment.reason).toContain('complex');
    });
  });

  describe('knowledge updates', () => {
    it('generates knowledge updates for incorrect predictions', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      expect(result.knowledgeUpdates.length).toBeGreaterThan(0);
    });

    it('generates knowledge updates for correct high-confidence predictions', async () => {
      const highConfPrediction: Prediction = {
        ...mockPrediction,
        statedConfidence: { score: 0.9, tier: 'high', source: 'measured' },
      };

      const result = await learnFromOutcome(highConfPrediction, mockCorrectOutcome, mockContext);

      expect(result.knowledgeUpdates.length).toBeGreaterThan(0);
    });

    it('each knowledge update has required structure', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      for (const update of result.knowledgeUpdates) {
        expect(update).toHaveProperty('entityId');
        expect(update).toHaveProperty('updateType');
        expect(update).toHaveProperty('before');
        expect(update).toHaveProperty('after');
        expect(update).toHaveProperty('reason');
        expect(update).toHaveProperty('timestamp');
      }
    });

    it('claim revision for incorrect predictions', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      const claimRevision = result.knowledgeUpdates.find(
        (u) => u.updateType === 'claim_revise'
      );

      expect(claimRevision).toBeDefined();
      if (claimRevision) {
        expect(claimRevision.after).toContain('REVISED');
      }
    });
  });

  describe('pattern extraction', () => {
    it('extracts patterns from outcomes', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

      // May or may not extract patterns depending on conditions
      expect(Array.isArray(result.patternsExtracted)).toBe(true);
    });

    it('can disable pattern extraction', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext, {
        extractPatterns: false,
      });

      expect(result.patternsExtracted.length).toBe(0);
    });

    it('each extracted pattern has required structure', async () => {
      // Use context that might trigger pattern extraction
      const highHistoryContext: PredictionContext = {
        ...mockContext,
        priorSimilarPredictions: 100,
      };

      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, highHistoryContext, {
        minPatternSupport: 1, // Lower threshold for testing
      });

      for (const pattern of result.patternsExtracted) {
        expect(pattern).toHaveProperty('id');
        expect(pattern).toHaveProperty('name');
        expect(pattern).toHaveProperty('description');
        expect(pattern).toHaveProperty('trigger');
        expect(pattern).toHaveProperty('indication');
        expect(pattern).toHaveProperty('confidence');
        expect(pattern).toHaveProperty('supportingExamples');
      }
    });
  });

  describe('defeater identification', () => {
    it('identifies defeaters for incorrect predictions', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      expect(result.newDefeaters.length).toBeGreaterThan(0);
    });

    it('does not identify defeaters for correct predictions', async () => {
      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, mockContext);

      expect(result.newDefeaters.length).toBe(0);
    });

    it('each defeater has required structure', async () => {
      const result = await learnFromOutcome(mockPrediction, mockIncorrectOutcome, mockContext);

      for (const defeater of result.newDefeaters) {
        expect(defeater).toHaveProperty('id');
        expect(defeater).toHaveProperty('targetClaimId');
        expect(defeater).toHaveProperty('type');
        expect(defeater).toHaveProperty('description');
        expect(defeater).toHaveProperty('strength');
        expect(defeater).toHaveProperty('evidence');
        expect(['rebutting', 'undercutting']).toContain(defeater.type);
        expect(defeater.strength).toBeGreaterThanOrEqual(0);
        expect(defeater.strength).toBeLessThanOrEqual(1);
      }
    });

    it('high confidence failures create undercutting defeaters', async () => {
      const highConfPrediction: Prediction = {
        ...mockPrediction,
        statedConfidence: { score: 0.95, tier: 'high', source: 'measured' },
      };

      const result = await learnFromOutcome(highConfPrediction, mockIncorrectOutcome, mockContext);

      const undercutting = result.newDefeaters.find((d) => d.type === 'undercutting');
      expect(undercutting).toBeDefined();
    });
  });

  describe('verification methods', () => {
    it('handles automated verification', async () => {
      const automatedOutcome: Outcome = {
        ...mockCorrectOutcome,
        verificationMethod: 'automated',
      };

      const result = await learnFromOutcome(mockPrediction, automatedOutcome, mockContext);

      expect(result).toBeDefined();
      expect(result.outcomesProcessed).toBe(1);
    });

    it('handles human verification', async () => {
      const humanOutcome: Outcome = {
        ...mockCorrectOutcome,
        verificationMethod: 'human',
      };

      const result = await learnFromOutcome(mockPrediction, humanOutcome, mockContext);

      expect(result).toBeDefined();
      expect(result.outcomesProcessed).toBe(1);
    });

    it('handles downstream_success verification', async () => {
      const downstreamOutcome: Outcome = {
        ...mockCorrectOutcome,
        verificationMethod: 'downstream_success',
      };

      const result = await learnFromOutcome(mockPrediction, downstreamOutcome, mockContext);

      expect(result).toBeDefined();
      expect(result.outcomesProcessed).toBe(1);
    });
  });

  describe('context complexity', () => {
    it('handles simple complexity', async () => {
      const simpleContext: PredictionContext = {
        ...mockContext,
        complexity: 'simple',
      };

      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, simpleContext);

      expect(result).toBeDefined();
    });

    it('handles moderate complexity', async () => {
      const moderateContext: PredictionContext = {
        ...mockContext,
        complexity: 'moderate',
      };

      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, moderateContext);

      expect(result).toBeDefined();
    });

    it('handles complex complexity', async () => {
      const complexContext: PredictionContext = {
        ...mockContext,
        complexity: 'complex',
      };

      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, complexContext);

      expect(result).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles prediction without entityId', async () => {
      const predWithoutEntity: Prediction = {
        ...mockPrediction,
        entityId: undefined,
      };

      const result = await learnFromOutcome(predWithoutEntity, mockIncorrectOutcome, mockContext);

      expect(result).toBeDefined();
      expect(result.confidenceAdjustments.length).toBe(0); // No entity to adjust
      expect(result.newDefeaters.length).toBe(0); // No claim to defeat
    });

    it('handles prediction without tags', async () => {
      const predWithoutTags: Prediction = {
        ...mockPrediction,
        tags: undefined,
      };

      const result = await learnFromOutcome(predWithoutTags, mockCorrectOutcome, mockContext);

      expect(result).toBeDefined();
    });

    it('handles context without optional fields', async () => {
      const minimalContext: PredictionContext = {
        domain: 'test',
        complexity: 'simple',
        features: {},
      };

      const result = await learnFromOutcome(mockPrediction, mockCorrectOutcome, minimalContext);

      expect(result).toBeDefined();
    });
  });

  describe('createLearnFromOutcome', () => {
    it('creates a bound learning function with default options', async () => {
      const boundLearn = createLearnFromOutcome({
        adjustmentFactor: 0.2,
        extractPatterns: false,
      });

      const result = await boundLearn(mockPrediction, mockCorrectOutcome, mockContext);

      expect(result.patternsExtracted.length).toBe(0);
    });

    it('allows overriding default options', async () => {
      const boundLearn = createLearnFromOutcome({
        extractPatterns: false,
      });

      const result = await boundLearn(mockPrediction, mockCorrectOutcome, mockContext, {
        extractPatterns: true,
      });

      // Should use the override
      expect(Array.isArray(result.patternsExtracted)).toBe(true);
    });
  });
});
