/**
 * @fileoverview Tests for Adversarial Test Generation Primitive
 */

import { describe, it, expect } from 'vitest';
import {
  generateAdversarialTests,
  createGenerateAdversarialTests,
  type Weakness,
  type GenerateAdversarialTestsOptions,
} from '../adversarial_test.js';

describe('generateAdversarialTests', () => {
  const mockNullHandlingWeakness: Weakness = {
    id: 'weak-1',
    type: 'null_handling',
    description: 'Parser crashes on null input',
    affectedComponent: 'Parser',
    discoveredBy: 'tp_analyze_consistency',
  };

  const mockEdgeCaseWeakness: Weakness = {
    id: 'weak-2',
    type: 'edge_case',
    description: 'Array processor fails on empty arrays',
    affectedComponent: 'ArrayProcessor',
    discoveredBy: 'manual_testing',
    gettierRisk: 0.3,
  };

  const mockRaceConditionWeakness: Weakness = {
    id: 'weak-3',
    type: 'race_condition',
    description: 'Data corruption under concurrent writes',
    affectedComponent: 'CacheManager',
    discoveredBy: 'tp_analyze_architecture',
  };

  it('returns result structure with all required fields', async () => {
    const result = await generateAdversarialTests(mockNullHandlingWeakness);

    expect(result).toHaveProperty('tests');
    expect(result).toHaveProperty('expectedFailureModes');
    expect(result).toHaveProperty('coverageAnalysis');
    expect(result).toHaveProperty('coverageGaps');
    expect(result).toHaveProperty('edgeCases');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(Array.isArray(result.tests)).toBe(true);
    expect(Array.isArray(result.expectedFailureModes)).toBe(true);
    expect(Array.isArray(result.coverageGaps)).toBe(true);
    expect(Array.isArray(result.edgeCases)).toBe(true);
  });

  describe('test generation', () => {
    it('generates tests for null handling weakness', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      expect(result.tests.length).toBeGreaterThan(0);
      // Should include null/undefined inputs
      expect(result.tests.some((t) =>
        t.input === null || t.input === undefined
      )).toBe(true);
    });

    it('generates tests for edge case weakness', async () => {
      const result = await generateAdversarialTests(mockEdgeCaseWeakness);

      expect(result.tests.length).toBeGreaterThan(0);
      // Should include empty inputs
      expect(result.tests.some((t) =>
        t.input === '' || (Array.isArray(t.input) && t.input.length === 0)
      )).toBe(true);
    });

    it('generates tests for race condition weakness', async () => {
      const result = await generateAdversarialTests(mockRaceConditionWeakness);

      expect(result.tests.length).toBeGreaterThan(0);
      // Should include concurrent operation inputs
      expect(result.tests.some((t) =>
        typeof t.input === 'object' && t.input !== null && 'concurrent' in t.input
      )).toBe(true);
    });

    it('each test has required structure', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      for (const test of result.tests) {
        expect(test).toHaveProperty('id');
        expect(test).toHaveProperty('name');
        expect(test).toHaveProperty('description');
        expect(test).toHaveProperty('input');
        expect(test).toHaveProperty('expectedBehavior');
        expect(test).toHaveProperty('difficulty');
        expect(test).toHaveProperty('targetedWeakness');
        expect(test).toHaveProperty('testCode');
        expect(test).toHaveProperty('assertion');
        expect(test).toHaveProperty('timeoutMs');
      }
    });

    it('test IDs are unique', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness, {
        maxTests: 20,
      });

      const ids = result.tests.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('tests target the correct weakness', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      for (const test of result.tests) {
        expect(test.targetedWeakness).toBe(mockNullHandlingWeakness.id);
      }
    });
  });

  describe('difficulty levels', () => {
    it('respects difficulty option', async () => {
      const easyResult = await generateAdversarialTests(mockEdgeCaseWeakness, {
        difficulty: 'easy',
      });
      const hardResult = await generateAdversarialTests(mockEdgeCaseWeakness, {
        difficulty: 'hard',
      });

      // All tests should match the requested difficulty
      expect(easyResult.tests.every((t) => t.difficulty === 'easy')).toBe(true);
      expect(hardResult.tests.every((t) => t.difficulty === 'hard')).toBe(true);
    });

    it('harder difficulty generates more extreme inputs', async () => {
      const easyResult = await generateAdversarialTests(mockEdgeCaseWeakness, {
        difficulty: 'easy',
        maxTests: 10,
      });
      const extremeResult = await generateAdversarialTests(mockEdgeCaseWeakness, {
        difficulty: 'extreme',
        maxTests: 10,
      });

      // Extreme should include larger/more complex inputs
      const extremeHasLargeInputs = extremeResult.tests.some((t) => {
        if (Array.isArray(t.input)) return t.input.length > 1000;
        if (typeof t.input === 'number') {
          return t.input === Number.MAX_SAFE_INTEGER || t.input === Number.MIN_SAFE_INTEGER;
        }
        return false;
      });

      expect(extremeHasLargeInputs).toBe(true);
    });
  });

  describe('expected behaviors', () => {
    it('assigns expected behaviors based on weakness type', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      for (const test of result.tests) {
        expect(['fail', 'degrade', 'timeout', 'incorrect_output', 'crash']).toContain(
          test.expectedBehavior
        );
      }
    });

    it('null handling tests expect fail behavior', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      const nullTests = result.tests.filter((t) =>
        t.input === null || t.input === undefined
      );
      expect(nullTests.length).toBeGreaterThan(0);
      expect(nullTests.every((t) => t.expectedBehavior === 'fail')).toBe(true);
    });

    it('race condition tests expect incorrect_output', async () => {
      const result = await generateAdversarialTests(mockRaceConditionWeakness);

      expect(result.tests.some((t) => t.expectedBehavior === 'incorrect_output')).toBe(true);
    });
  });

  describe('failure modes', () => {
    it('identifies failure modes for the weakness', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      expect(result.expectedFailureModes.length).toBeGreaterThan(0);
    });

    it('each failure mode has required structure', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      for (const mode of result.expectedFailureModes) {
        expect(mode).toHaveProperty('mode');
        expect(mode).toHaveProperty('probability');
        expect(mode).toHaveProperty('severity');
        expect(mode).toHaveProperty('recovery');
        expect(mode.probability).toBeGreaterThanOrEqual(0);
        expect(mode.probability).toBeLessThanOrEqual(1);
        expect(['crash', 'incorrect', 'degraded', 'slow']).toContain(mode.severity);
      }
    });

    it('null handling includes null pointer exception mode', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      expect(result.expectedFailureModes.some((m) =>
        m.mode.includes('null') || m.mode.includes('pointer')
      )).toBe(true);
    });
  });

  describe('coverage analysis', () => {
    it('provides coverage analysis for the weakness', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      expect(result.coverageAnalysis).toHaveProperty('weaknessId');
      expect(result.coverageAnalysis).toHaveProperty('testsCovering');
      expect(result.coverageAnalysis).toHaveProperty('uncoveredAspects');
      expect(result.coverageAnalysis).toHaveProperty('coverageScore');
    });

    it('coverage score is in valid range', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      expect(result.coverageAnalysis.coverageScore).toBeGreaterThanOrEqual(0);
      expect(result.coverageAnalysis.coverageScore).toBeLessThanOrEqual(1);
    });

    it('tests covering matches generated test IDs', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      const testIds = result.tests.map((t) => t.id);
      for (const coverId of result.coverageAnalysis.testsCovering) {
        expect(testIds).toContain(coverId);
      }
    });
  });

  describe('coverage gaps', () => {
    it('identifies coverage gaps', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness, {
        maxTests: 2,
      });

      // With limited tests, there should be gaps
      expect(Array.isArray(result.coverageGaps)).toBe(true);
    });

    it('each gap has required structure', async () => {
      const result = await generateAdversarialTests(mockRaceConditionWeakness, {
        maxTests: 2,
      });

      for (const gap of result.coverageGaps) {
        expect(gap).toHaveProperty('area');
        expect(gap).toHaveProperty('description');
        expect(gap).toHaveProperty('severity');
        expect(gap).toHaveProperty('suggestedTest');
        expect(['critical', 'high', 'medium', 'low']).toContain(gap.severity);
      }
    });
  });

  describe('edge cases identification', () => {
    it('identifies edge cases for the weakness', async () => {
      const result = await generateAdversarialTests(mockEdgeCaseWeakness);

      expect(result.edgeCases.length).toBeGreaterThan(0);
    });

    it('each edge case has required structure', async () => {
      const result = await generateAdversarialTests(mockEdgeCaseWeakness);

      for (const edgeCase of result.edgeCases) {
        expect(edgeCase).toHaveProperty('name');
        expect(edgeCase).toHaveProperty('description');
        expect(edgeCase).toHaveProperty('exampleInput');
        expect(edgeCase).toHaveProperty('problematicReason');
        expect(edgeCase).toHaveProperty('hasTest');
        expect(typeof edgeCase.hasTest).toBe('boolean');
      }
    });
  });

  describe('options', () => {
    it('respects maxTests option', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness, {
        maxTests: 3,
      });

      expect(result.tests.length).toBeLessThanOrEqual(3);
    });

    it('respects testTimeoutMs option', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness, {
        testTimeoutMs: 10000,
      });

      for (const test of result.tests) {
        expect(test.timeoutMs).toBe(10000);
      }
    });
  });

  describe('test code generation', () => {
    it('generates valid test code', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      for (const test of result.tests) {
        expect(test.testCode).toBeDefined();
        expect(test.testCode.length).toBeGreaterThan(0);
        // Should contain describe and it blocks
        expect(test.testCode).toContain('describe');
        expect(test.testCode).toContain('it');
      }
    });

    it('test code includes input value', async () => {
      const result = await generateAdversarialTests(mockNullHandlingWeakness);

      for (const test of result.tests) {
        // Test code should have some representation of the input
        expect(test.testCode).toContain('input');
      }
    });
  });

  describe('weakness types', () => {
    const weaknessTypes = [
      { type: 'boundary' as const, desc: 'Integer boundary issues' },
      { type: 'resource_exhaustion' as const, desc: 'Memory exhaustion' },
      { type: 'semantic_confusion' as const, desc: 'Ambiguous string parsing' },
      { type: 'type_coercion' as const, desc: 'String to number conversion' },
      { type: 'concurrency' as const, desc: 'Thread safety issues' },
    ];

    for (const { type, desc } of weaknessTypes) {
      it(`handles ${type} weakness type`, async () => {
        const weakness: Weakness = {
          id: `weak-${type}`,
          type,
          description: desc,
          affectedComponent: 'TestComponent',
          discoveredBy: 'unit_test',
        };

        const result = await generateAdversarialTests(weakness);

        expect(result.tests.length).toBeGreaterThan(0);
        expect(result.expectedFailureModes.length).toBeGreaterThan(0);
      });
    }
  });

  describe('createGenerateAdversarialTests', () => {
    it('creates a bound generation function with default options', async () => {
      const boundGenerate = createGenerateAdversarialTests({
        difficulty: 'medium',
        maxTests: 5,
      });

      const result = await boundGenerate(mockNullHandlingWeakness);

      expect(result.tests.length).toBeLessThanOrEqual(5);
      expect(result.tests.every((t) => t.difficulty === 'medium')).toBe(true);
    });

    it('allows overriding default options', async () => {
      const boundGenerate = createGenerateAdversarialTests({
        maxTests: 5,
      });

      const result = await boundGenerate(mockNullHandlingWeakness, { maxTests: 2 });

      expect(result.tests.length).toBeLessThanOrEqual(2);
    });
  });
});
