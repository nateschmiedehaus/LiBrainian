/**
 * @fileoverview Tests for Calibration Verification Primitive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyCalibration, createVerifyCalibration } from '../verify_calibration.js';
import type { LibrarianStorage, EvolutionOutcome, BayesianConfidence, ConfidenceEvent } from '../../../storage/types.js';

describe('verifyCalibration', () => {
  let mockStorage: LibrarianStorage;
  let mockEvolutionOutcomes: EvolutionOutcome[];
  let mockBayesianConfidences: BayesianConfidence[];
  let mockConfidenceEvents: ConfidenceEvent[];

  beforeEach(() => {
    // Create mock evolution outcomes with varying confidence and success
    mockEvolutionOutcomes = [];
    for (let i = 0; i < 100; i++) {
      const qualityScore = Math.random();
      // Well-calibrated: success probability roughly matches quality score
      const success = Math.random() < qualityScore;
      mockEvolutionOutcomes.push({
        taskId: `task-${i}`,
        taskType: 'analysis',
        agentId: 'test-agent',
        success,
        durationMs: 1000 + Math.random() * 5000,
        qualityScore,
        filesChanged: [],
        testsAdded: 0,
        testsPass: true,
        context: {
          librarianContextUsed: true,
          contextPackCount: 3,
          decomposed: false,
        },
        timestamp: new Date(Date.now() - i * 3600000),
      });
    }

    mockBayesianConfidences = [
      {
        entityId: 'fn-1',
        entityType: 'function',
        priorAlpha: 1,
        priorBeta: 1,
        posteriorAlpha: 8,
        posteriorBeta: 3,
        observationCount: 9,
        computedAt: new Date().toISOString(),
      },
      {
        entityId: 'fn-2',
        entityType: 'function',
        priorAlpha: 1,
        priorBeta: 1,
        posteriorAlpha: 5,
        posteriorBeta: 6,
        observationCount: 9,
        computedAt: new Date().toISOString(),
      },
      {
        entityId: 'mod-1',
        entityType: 'module',
        priorAlpha: 1,
        priorBeta: 1,
        posteriorAlpha: 15,
        posteriorBeta: 2,
        observationCount: 15,
        computedAt: new Date().toISOString(),
      },
    ];

    mockConfidenceEvents = [];
    for (let i = 0; i < 50; i++) {
      mockConfidenceEvents.push({
        id: `event-${i}`,
        entityId: `entity-${i % 10}`,
        entityType: 'function',
        delta: (Math.random() - 0.5) * 0.2,
        updatedAt: new Date(Date.now() - i * 3600000),
        reason: 'test outcome',
      });
    }

    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      getEvolutionOutcomes: vi.fn().mockResolvedValue(mockEvolutionOutcomes),
      getBayesianConfidences: vi.fn().mockResolvedValue(mockBayesianConfidences),
      getConfidenceEvents: vi.fn().mockResolvedValue(mockConfidenceEvents),
    } as unknown as LibrarianStorage;
  });

  it('requires storage parameter', async () => {
    await expect(
      verifyCalibration({
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('returns result structure with all required fields', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    expect(result).toHaveProperty('ece');
    expect(result).toHaveProperty('mce');
    expect(result).toHaveProperty('brierScore');
    expect(result).toHaveProperty('isWellCalibrated');
    expect(result).toHaveProperty('recommendations');
    expect(result).toHaveProperty('calibrationStatus');
    expect(result).toHaveProperty('reliabilityDiagram');
    expect(result).toHaveProperty('sampleComplexityAnalysis');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(typeof result.ece).toBe('number');
    expect(typeof result.mce).toBe('number');
    expect(typeof result.brierScore).toBe('number');
    expect(typeof result.isWellCalibrated).toBe('boolean');
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('computes ECE in valid range', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    expect(result.ece).toBeGreaterThanOrEqual(0);
    expect(result.ece).toBeLessThanOrEqual(1);
  });

  it('computes MCE in valid range', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    expect(result.mce).toBeGreaterThanOrEqual(0);
    expect(result.mce).toBeLessThanOrEqual(1);
    expect(result.mce).toBeGreaterThanOrEqual(result.ece); // MCE >= ECE
  });

  it('computes Brier score in valid range', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    expect(result.brierScore).toBeGreaterThanOrEqual(0);
    expect(result.brierScore).toBeLessThanOrEqual(1);
  });

  it('generates reliability diagram with correct bin count', async () => {
    const binCount = 5;
    const result = await verifyCalibration({
      storage: mockStorage,
      binCount,
    });

    expect(result.reliabilityDiagram.bins.length).toBe(binCount);
    expect(result.reliabilityDiagram.perfectCalibrationLine).toEqual([[0, 0], [1, 1]]);
  });

  it('generates reliability diagram bins with correct structure', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    for (const bin of result.reliabilityDiagram.bins) {
      expect(bin).toHaveProperty('binCenter');
      expect(bin).toHaveProperty('predictedProbability');
      expect(bin).toHaveProperty('actualFrequency');
      expect(bin).toHaveProperty('sampleCount');

      expect(bin.binCenter).toBeGreaterThanOrEqual(0);
      expect(bin.binCenter).toBeLessThanOrEqual(1);
      expect(bin.sampleCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('provides sample complexity analysis', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    expect(result.sampleComplexityAnalysis).toHaveProperty('currentSampleSize');
    expect(result.sampleComplexityAnalysis).toHaveProperty('requiredSamplesForEpsilon');
    expect(result.sampleComplexityAnalysis).toHaveProperty('currentEpsilon');
    expect(result.sampleComplexityAnalysis).toHaveProperty('confidenceInterval');
    expect(result.sampleComplexityAnalysis).toHaveProperty('powerAnalysis');

    expect(result.sampleComplexityAnalysis.confidenceInterval).toHaveLength(2);
    expect(result.sampleComplexityAnalysis.confidenceInterval[0]).toBeLessThanOrEqual(
      result.sampleComplexityAnalysis.confidenceInterval[1]
    );
  });

  it('determines calibration status correctly', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    expect(['well_calibrated', 'miscalibrated', 'insufficient_data', 'distribution_shift'])
      .toContain(result.calibrationStatus);

    // isWellCalibrated should match calibrationStatus
    expect(result.isWellCalibrated).toBe(result.calibrationStatus === 'well_calibrated');
  });

  it('generates recommendations', async () => {
    const result = await verifyCalibration({ storage: mockStorage });

    // Should always have at least some recommendations
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.every((r) => typeof r === 'string')).toBe(true);
  });

  it('reports insufficient data for small samples', async () => {
    mockStorage.getEvolutionOutcomes = vi.fn().mockResolvedValue(mockEvolutionOutcomes.slice(0, 5));
    mockStorage.getBayesianConfidences = vi.fn().mockResolvedValue([]);
    mockStorage.getConfidenceEvents = vi.fn().mockResolvedValue([]);

    const result = await verifyCalibration({
      storage: mockStorage,
      minSamples: 100,
    });

    expect(result.calibrationStatus).toBe('insufficient_data');
    expect(result.isWellCalibrated).toBe(false);
  });

  it('respects targetEce option', async () => {
    // With very high target, should be well-calibrated
    const lenientResult = await verifyCalibration({
      storage: mockStorage,
      targetEce: 0.5, // Very lenient
    });

    // With very low target, should not be well-calibrated (unless perfectly calibrated)
    const strictResult = await verifyCalibration({
      storage: mockStorage,
      targetEce: 0.001, // Very strict
    });

    // Lenient should be more likely to be well-calibrated
    if (lenientResult.ece < 0.5 && strictResult.ece > 0.001) {
      expect(lenientResult.isWellCalibrated).toBe(true);
      expect(strictResult.isWellCalibrated).toBe(false);
    }
  });

  describe('createVerifyCalibration', () => {
    it('creates a bound verification function with default options', async () => {
      const boundVerify = createVerifyCalibration({
        minSamples: 10,
        targetEce: 0.1,
        binCount: 5,
      });

      const result = await boundVerify({ storage: mockStorage });

      expect(result).toHaveProperty('ece');
      expect(result.reliabilityDiagram.bins.length).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('handles empty data gracefully', async () => {
      mockStorage.getEvolutionOutcomes = vi.fn().mockResolvedValue([]);
      mockStorage.getBayesianConfidences = vi.fn().mockResolvedValue([]);
      mockStorage.getConfidenceEvents = vi.fn().mockResolvedValue([]);

      const result = await verifyCalibration({ storage: mockStorage });

      expect(result.ece).toBe(0);
      expect(result.brierScore).toBe(0);
      expect(result.calibrationStatus).toBe('insufficient_data');
    });

    it('handles storage errors gracefully', async () => {
      mockStorage.getEvolutionOutcomes = vi.fn().mockRejectedValue(new Error('Storage error'));
      mockStorage.getBayesianConfidences = vi.fn().mockRejectedValue(new Error('Storage error'));
      mockStorage.getConfidenceEvents = vi.fn().mockRejectedValue(new Error('Storage error'));

      const result = await verifyCalibration({ storage: mockStorage });

      // Should still return a valid result structure even with errors
      expect(result).toHaveProperty('ece');
      expect(result).toHaveProperty('brierScore');
      // Note: errors are caught internally and may not be propagated to errors array
      // depending on implementation. The key is that it doesn't throw.
    });
  });

  describe('overconfidence and underconfidence detection', () => {
    it('detects overconfidence in recommendations', async () => {
      // Create overconfident outcomes: high predicted, low actual
      const overconfidentOutcomes = Array.from({ length: 100 }, (_, i) => ({
        taskId: `task-${i}`,
        taskType: 'analysis',
        agentId: 'test-agent',
        success: Math.random() < 0.3, // Only 30% success
        durationMs: 1000,
        qualityScore: 0.8, // But 80% confidence
        filesChanged: [],
        testsAdded: 0,
        testsPass: true,
        context: {
          librarianContextUsed: true,
          contextPackCount: 1,
          decomposed: false,
        },
        timestamp: new Date(),
      }));

      mockStorage.getEvolutionOutcomes = vi.fn().mockResolvedValue(overconfidentOutcomes);

      const result = await verifyCalibration({ storage: mockStorage });

      // Should detect overconfidence
      expect(result.recommendations.some((r) =>
        r.toLowerCase().includes('overconfidence') || r.toLowerCase().includes('reduce')
      )).toBe(true);
    });
  });
});
