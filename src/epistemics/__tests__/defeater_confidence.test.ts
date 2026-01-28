/**
 * @fileoverview Tests for Defeater-ConfidenceValue Integration (WU-THIMPL-104)
 *
 * Tests cover:
 * - applyDefeaterToConfidence function
 * - applyDefeatersToConfidence for multiple defeaters
 * - findDefeatersInConfidence for provenance inspection
 * - removeDefeaterFromConfidence for restoration
 */

import { describe, it, expect } from 'vitest';
import {
  applyDefeaterToConfidence,
  applyDefeatersToConfidence,
  findDefeatersInConfidence,
  removeDefeaterFromConfidence,
  type DefeaterApplicationResult,
} from '../defeaters.js';
import {
  createDefeater,
  createClaimId,
  type ExtendedDefeater,
} from '../types.js';
import {
  deterministic,
  measuredConfidence,
  bounded,
  absent,
  type ConfidenceValue,
  type DerivedConfidence,
} from '../confidence.js';

describe('Defeater-ConfidenceValue Integration (WU-THIMPL-104)', () => {
  // Test fixtures
  const measured = measuredConfidence({
    datasetId: 'test-dataset',
    sampleSize: 100,
    accuracy: 0.85,
    ci95: [0.80, 0.90],
  });

  const deterministicTrue = deterministic(true, 'test_true');

  const createTestDefeater = (
    id: string,
    severity: 'full' | 'partial' | 'warning' | 'informational',
    confidenceReduction: number = 0.2
  ): ExtendedDefeater => ({
    id,
    type: 'code_change',
    description: `Test defeater ${id}`,
    severity,
    detectedAt: new Date().toISOString(),
    status: 'active',
    affectedClaimIds: [createClaimId('test-claim')],
    confidenceReduction,
    autoResolvable: false,
  });

  describe('applyDefeaterToConfidence', () => {
    it('should fully defeat confidence with full severity', () => {
      const defeater = createTestDefeater('def1', 'full', 0.5);
      const result = applyDefeaterToConfidence(measured, defeater);

      expect(result.fullyDefeated).toBe(true);
      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        expect(result.confidence.value).toBe(0.0);
        expect(result.confidence.formula).toBe('defeated_by(code_change)');
        expect(result.confidence.calibrationStatus).toBe('degraded');
      }
      expect(result.originalConfidence).toBe(measured);
      expect(result.defeaterId).toBe('def1');
    });

    it('should partially reduce confidence with partial severity', () => {
      const defeater = createTestDefeater('def2', 'partial', 0.3);
      const result = applyDefeaterToConfidence(measured, defeater);

      expect(result.fullyDefeated).toBe(false);
      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        expect(result.confidence.value).toBeCloseTo(0.55); // 0.85 - 0.3
        expect(result.confidence.formula).toContain('partial_defeat');
      }
    });

    it('should apply smaller reduction with warning severity', () => {
      const defeater = createTestDefeater('def3', 'warning', 0.4);
      const result = applyDefeaterToConfidence(measured, defeater);

      expect(result.fullyDefeated).toBe(false);
      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        // Warning applies half the reduction
        expect(result.confidence.value).toBeCloseTo(0.65); // 0.85 - 0.2
        expect(result.confidence.formula).toContain('warning');
      }
    });

    it('should not reduce confidence with informational severity', () => {
      const defeater = createTestDefeater('def4', 'informational', 0.5);
      const result = applyDefeaterToConfidence(measured, defeater);

      expect(result.fullyDefeated).toBe(false);
      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        expect(result.confidence.value).toBe(0.85); // Unchanged
        expect(result.confidence.formula).toContain('noted');
      }
    });

    it('should handle absent confidence without effect', () => {
      const absentConf = absent('uncalibrated');
      const defeater = createTestDefeater('def5', 'full', 1.0);
      const result = applyDefeaterToConfidence(absentConf, defeater);

      expect(result.confidence).toBe(absentConf);
      expect(result.fullyDefeated).toBe(false);
      expect(result.description).toContain('already absent');
    });

    it('should handle deterministic confidence', () => {
      const defeater = createTestDefeater('def6', 'full', 1.0);
      const result = applyDefeaterToConfidence(deterministicTrue, defeater);

      expect(result.fullyDefeated).toBe(true);
      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        expect(result.confidence.value).toBe(0.0);
        expect(result.confidence.inputs).toHaveLength(2);
        expect(result.confidence.inputs[0].confidence).toBe(deterministicTrue);
      }
    });

    it('should clamp reduction to 0 minimum', () => {
      const lowConfidence = measuredConfidence({
        datasetId: 'low',
        sampleSize: 50,
        accuracy: 0.1,
        ci95: [0.05, 0.15],
      });
      const defeater = createTestDefeater('def7', 'partial', 0.5);
      const result = applyDefeaterToConfidence(lowConfidence, defeater);

      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        expect(result.confidence.value).toBe(0.0); // Clamped to 0
      }
      expect(result.fullyDefeated).toBe(true);
    });

    it('should include defeater ID in provenance', () => {
      const defeater = createTestDefeater('unique-defeater-id', 'partial', 0.2);
      const result = applyDefeaterToConfidence(measured, defeater);

      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        const defeaterInput = result.confidence.inputs.find((i) => i.name === 'defeater');
        expect(defeaterInput).toBeDefined();
        if (defeaterInput?.confidence.type === 'deterministic') {
          expect(defeaterInput.confidence.reason).toBe('defeater_unique-defeater-id');
        }
      }
    });
  });

  describe('applyDefeatersToConfidence', () => {
    it('should return unchanged confidence for empty defeaters array', () => {
      const result = applyDefeatersToConfidence(measured, []);

      expect(result.confidence).toBe(measured);
      expect(result.fullyDefeated).toBe(false);
      expect(result.applications).toHaveLength(0);
    });

    it('should apply multiple defeaters in sequence', () => {
      const def1 = createTestDefeater('seq1', 'partial', 0.1);
      const def2 = createTestDefeater('seq2', 'partial', 0.1);
      const result = applyDefeatersToConfidence(measured, [def1, def2]);

      expect(result.applications).toHaveLength(2);
      expect(result.confidence.type).toBe('derived');
      if (result.confidence.type === 'derived') {
        // 0.85 - 0.1 - 0.1 = 0.65
        expect(result.confidence.value).toBeCloseTo(0.65);
      }
    });

    it('should stop reducing after full defeat', () => {
      const def1 = createTestDefeater('stop1', 'full', 1.0);
      const def2 = createTestDefeater('stop2', 'partial', 0.2);
      const result = applyDefeatersToConfidence(measured, [def1, def2]);

      expect(result.fullyDefeated).toBe(true);
      expect(result.applications).toHaveLength(2);
      // Second defeater still recorded but has no effect
      expect(result.applications[0].fullyDefeated).toBe(true);
    });

    it('should record all defeater applications', () => {
      const defeaters = [
        createTestDefeater('rec1', 'warning', 0.2),
        createTestDefeater('rec2', 'informational', 0.0),
        createTestDefeater('rec3', 'partial', 0.1),
      ];
      const result = applyDefeatersToConfidence(measured, defeaters);

      expect(result.applications).toHaveLength(3);
      expect(result.applications[0].defeaterId).toBe('rec1');
      expect(result.applications[1].defeaterId).toBe('rec2');
      expect(result.applications[2].defeaterId).toBe('rec3');
    });
  });

  describe('findDefeatersInConfidence', () => {
    it('should return empty array for non-derived confidence', () => {
      const result = findDefeatersInConfidence(measured);
      expect(result).toHaveLength(0);
    });

    it('should find single defeater in provenance', () => {
      const defeater = createTestDefeater('find1', 'partial', 0.2);
      const { confidence } = applyDefeaterToConfidence(measured, defeater);

      const result = findDefeatersInConfidence(confidence);
      expect(result).toHaveLength(1);
      expect(result).toContain('find1');
    });

    it('should find multiple defeaters in chain', () => {
      const def1 = createTestDefeater('chain1', 'partial', 0.1);
      const def2 = createTestDefeater('chain2', 'warning', 0.1);
      const { confidence } = applyDefeatersToConfidence(measured, [def1, def2]);

      const result = findDefeatersInConfidence(confidence);
      expect(result).toHaveLength(2);
      expect(result).toContain('chain1');
      expect(result).toContain('chain2');
    });

    it('should find defeaters in nested derivations', () => {
      // First apply a defeater
      const defeater = createTestDefeater('nested1', 'partial', 0.1);
      const { confidence: defeated } = applyDefeaterToConfidence(measured, defeater);

      // Then wrap it in another derivation
      const wrapped: DerivedConfidence = {
        type: 'derived',
        value: 0.5,
        formula: 'some_other_formula',
        inputs: [
          { name: 'input', confidence: defeated },
        ],
      };

      const result = findDefeatersInConfidence(wrapped);
      expect(result).toContain('nested1');
    });
  });

  describe('removeDefeaterFromConfidence', () => {
    it('should return same confidence for non-derived values', () => {
      const result = removeDefeaterFromConfidence(measured);
      expect(result).toBe(measured);
    });

    it('should return original confidence after removing defeater', () => {
      const defeater = createTestDefeater('remove1', 'partial', 0.2);
      const { confidence: defeated } = applyDefeaterToConfidence(measured, defeater);

      const restored = removeDefeaterFromConfidence(defeated);
      expect(restored).toBe(measured);
    });

    it('should not modify non-defeater derivations', () => {
      const customDerived: DerivedConfidence = {
        type: 'derived',
        value: 0.7,
        formula: 'custom_formula',
        inputs: [{ name: 'input', confidence: measured }],
      };

      const result = removeDefeaterFromConfidence(customDerived);
      expect(result).toBe(customDerived);
    });

    it('should restore from full defeat', () => {
      const defeater = createTestDefeater('restore1', 'full', 1.0);
      const { confidence: defeated } = applyDefeaterToConfidence(deterministicTrue, defeater);

      const restored = removeDefeaterFromConfidence(defeated);
      expect(restored).toBe(deterministicTrue);
    });

    it('should handle all defeater formula types', () => {
      const formulas = ['defeated_by', 'partial_defeat', 'warning', 'noted', 'unknown_defeat'];

      for (const formula of formulas) {
        const derivedWithFormula: DerivedConfidence = {
          type: 'derived',
          value: 0.5,
          formula: `${formula}(test)`,
          inputs: [
            { name: 'original', confidence: measured },
            { name: 'defeater', confidence: deterministic(true, 'defeater_test') },
          ],
        };

        const result = removeDefeaterFromConfidence(derivedWithFormula);
        expect(result).toBe(measured);
      }
    });
  });

  describe('Integration: Full workflow', () => {
    it('should support apply -> inspect -> remove workflow', () => {
      // Start with a calibrated confidence
      const original = measuredConfidence({
        datasetId: 'workflow-test',
        sampleSize: 200,
        accuracy: 0.9,
        ci95: [0.87, 0.93],
      });

      // Apply multiple defeaters
      const defeaters = [
        createTestDefeater('wf1', 'partial', 0.1),
        createTestDefeater('wf2', 'warning', 0.2),
      ];
      const { confidence: defeated, applications } = applyDefeatersToConfidence(
        original,
        defeaters
      );

      // Inspect what defeaters were applied
      const foundDefeaters = findDefeatersInConfidence(defeated);
      expect(foundDefeaters).toContain('wf1');
      expect(foundDefeaters).toContain('wf2');

      // Verify the applications were recorded
      expect(applications).toHaveLength(2);

      // Remove the most recent defeater
      const partiallyRestored = removeDefeaterFromConfidence(defeated);
      expect(partiallyRestored.type).toBe('derived');

      // Remove the next defeater
      const fullyRestored = removeDefeaterFromConfidence(partiallyRestored);
      expect(fullyRestored).toBe(original);

      // Verify no defeaters remain
      expect(findDefeatersInConfidence(fullyRestored)).toHaveLength(0);
    });
  });
});
