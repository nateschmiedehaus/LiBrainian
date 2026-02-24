/**
 * @fileoverview Tests for Composition Framework
 *
 * Comprehensive tests for:
 * - Composition operators (sequence, parallel, conditional)
 * - Decorators (retry, timeout, caching, tracing)
 * - Confidence propagation (D2-D4 rules)
 * - Pipeline and parallel builders
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfidenceValue, DerivedConfidence } from '../../epistemics/confidence.js';
import { deterministic, absent, getNumericValue } from '../../epistemics/confidence.js';
import type { Context } from '../types.js';
import type { ConstructionResult } from '../base/construction_base.js';
import {
  ConstructionError,
  ConstructionCancelledError,
  ConstructionTimeoutError,
  toEvidenceIds,
} from '../base/construction_base.js';
import {
  // Composition operators
  sequence,
  parallel,
  conditional,
  // Decorators
  withRetry,
  withTimeout,
  withCache,
  withTracing,
  // Classes
  SequenceConstruction,
  ParallelConstruction,
  ConditionalConstruction,
  RetryConstruction,
  TimeoutConstruction,
  CachedConstruction,
  TracedConstruction,
  // Confidence propagation
  propagateSequential,
  propagateParallelAll,
  propagateParallelAny,
  propagateDerived,
  // Utilities
  createConstruction,
  createDeterministicConstruction,
  constant,
  pipeline,
  parallelBuilder,
  // Types
  type ComposableConstruction,
  type Tracer,
  type RetryConfig,
  type CacheConfig,
} from '../composition.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a simple test construction.
 */
function createTestConstruction<TInput, TData>(
  id: string,
  name: string,
  transform: (input: TInput) => TData,
  confidence: ConfidenceValue = deterministic(true, 'test')
): ComposableConstruction<TInput, ConstructionResult & { data: TData }> {
  return {
    id,
    name,
    async execute(input: TInput): Promise<ConstructionResult & { data: TData }> {
      return {
        data: transform(input),
        confidence,
        evidenceRefs: toEvidenceIds([`${id}:executed`]),
        analysisTimeMs: 1,
      };
    },
    getEstimatedConfidence(): ConfidenceValue {
      return confidence;
    },
  };
}

/**
 * Create a construction that fails.
 */
function createFailingConstruction(
  id: string,
  errorMessage: string = 'Test error'
): ComposableConstruction<unknown, ConstructionResult> {
  return {
    id,
    name: `Failing(${id})`,
    async execute(): Promise<ConstructionResult> {
      throw new Error(errorMessage);
    },
  };
}

/**
 * Create a construction that takes time.
 */
function createSlowConstruction<TInput>(
  id: string,
  delayMs: number,
  result: ConstructionResult & { data: unknown }
): ComposableConstruction<TInput, typeof result> {
  return {
    id,
    name: `Slow(${id}, ${delayMs}ms)`,
    async execute(): Promise<typeof result> {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return result;
    },
  };
}

/**
 * Create a mock tracer.
 */
function createMockTracer(): Tracer & {
  spans: Map<string, { name: string; events: Array<{ name: string; attributes?: Record<string, unknown> }>; attributes: Record<string, unknown>; ended: boolean }>;
} {
  const spans = new Map<string, { name: string; events: Array<{ name: string; attributes?: Record<string, unknown> }>; attributes: Record<string, unknown>; ended: boolean }>();
  let spanCounter = 0;

  return {
    spans,
    startSpan(name: string, options?: { parentId?: string; attributes?: Record<string, unknown> }): string {
      const spanId = `span_${++spanCounter}`;
      spans.set(spanId, {
        name,
        events: [],
        attributes: options?.attributes ?? {},
        ended: false,
      });
      return spanId;
    },
    endSpan(spanId: string): void {
      const span = spans.get(spanId);
      if (span) {
        span.ended = true;
      }
    },
    addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
      const span = spans.get(spanId);
      if (span) {
        span.events.push({ name, attributes });
      }
    },
    setAttribute(spanId: string, key: string, value: unknown): void {
      const span = spans.get(spanId);
      if (span) {
        span.attributes[key] = value;
      }
    },
  };
}

// ============================================================================
// CONFIDENCE PROPAGATION TESTS
// ============================================================================

describe('Confidence Propagation', () => {
  describe('propagateSequential (D2)', () => {
    it('should return minimum of all confidences', () => {
      const confidences: ConfidenceValue[] = [
        { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.7, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.7, confidenceInterval: [0.65, 0.75], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.8, measurement: { datasetId: 'c', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateSequential(confidences);
      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBe(0.7);
    });

    it('should handle single confidence', () => {
      const confidences: ConfidenceValue[] = [
        deterministic(true, 'single'),
      ];

      const result = propagateSequential(confidences);
      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBe(1.0);
    });

    it('should return absent for empty array', () => {
      const result = propagateSequential([]);
      expect(result.type).toBe('absent');
    });

    it('should handle absent confidences', () => {
      const confidences: ConfidenceValue[] = [
        { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } },
        absent('uncalibrated'),
      ];

      const result = propagateSequential(confidences);
      expect(result.type).toBe('absent');
    });
  });

  describe('propagateParallelAll (D3)', () => {
    it('should return product of all confidences', () => {
      const confidences: ConfidenceValue[] = [
        { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateParallelAll(confidences);
      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBeCloseTo(0.72, 5);
    });

    it('should return 0 if any confidence is 0', () => {
      const confidences: ConfidenceValue[] = [
        { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } },
        deterministic(false, 'zero'),
      ];

      const result = propagateParallelAll(confidences);
      expect(getNumericValue(result)).toBe(0);
    });

    it('should return absent for empty array', () => {
      const result = propagateParallelAll([]);
      expect(result.type).toBe('absent');
    });
  });

  describe('propagateParallelAny (D4)', () => {
    it('should return 1 - product(1 - c)', () => {
      const confidences: ConfidenceValue[] = [
        { type: 'measured', value: 0.6, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.7, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.7, confidenceInterval: [0.65, 0.75], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateParallelAny(confidences);
      expect(result.type).toBe('derived');
      // 1 - (0.4 * 0.3) = 1 - 0.12 = 0.88
      expect(getNumericValue(result)).toBeCloseTo(0.88, 5);
    });

    it('should return 1 if any confidence is 1', () => {
      const confidences: ConfidenceValue[] = [
        { type: 'measured', value: 0.5, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.5, confidenceInterval: [0.45, 0.55], measuredAt: new Date().toISOString() } },
        deterministic(true, 'certain'),
      ];

      const result = propagateParallelAny(confidences);
      expect(getNumericValue(result)).toBe(1);
    });

    it('should return absent for empty array', () => {
      const result = propagateParallelAny([]);
      expect(result.type).toBe('absent');
    });
  });

  describe('propagateDerived', () => {
    it('should support min formula', () => {
      const inputs: ConfidenceValue[] = [
        deterministic(true, 'a'),
        { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateDerived(inputs, 'min');
      expect(getNumericValue(result)).toBe(0.8);
    });

    it('should support max formula', () => {
      const inputs: ConfidenceValue[] = [
        { type: 'measured', value: 0.6, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateDerived(inputs, 'max');
      expect(getNumericValue(result)).toBe(0.8);
    });

    it('should support average formula', () => {
      const inputs: ConfidenceValue[] = [
        { type: 'measured', value: 0.6, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateDerived(inputs, 'average');
      expect(getNumericValue(result)).toBe(0.7);
    });

    it('should support noisy_or formula', () => {
      const inputs: ConfidenceValue[] = [
        { type: 'measured', value: 0.5, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.5, confidenceInterval: [0.45, 0.55], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.5, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.5, confidenceInterval: [0.45, 0.55], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateDerived(inputs, 'noisy_or');
      // 1 - (0.5 * 0.5) = 0.75
      expect(getNumericValue(result)).toBe(0.75);
    });

    it('should default to min for unknown formula', () => {
      const inputs: ConfidenceValue[] = [
        { type: 'measured', value: 0.6, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } },
        { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateDerived(inputs, 'unknown_formula');
      expect(getNumericValue(result)).toBe(0.6);
    });

    it('should track calibration status', () => {
      const inputs: ConfidenceValue[] = [
        { type: 'measured', value: 0.8, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
      ];

      const result = propagateDerived(inputs, 'max') as DerivedConfidence;
      expect(result.calibrationStatus).toBe('preserved');
    });
  });
});

// ============================================================================
// SEQUENCE CONSTRUCTION TESTS
// ============================================================================

describe('SequenceConstruction', () => {
  it('should execute constructions in order', async () => {
    const first = createTestConstruction('first', 'First', (n: number) => n * 2);
    const second = createTestConstruction<ConstructionResult & { data: number }, number>(
      'second',
      'Second',
      (input) => input.data + 10
    );

    const sequenced = sequence(first, second);
    const result = await sequenced.execute(5);

    expect(result.data).toBe(20); // 5 * 2 = 10, then 10 + 10 = 20
  });

  it('should propagate confidence using min (D2)', async () => {
    const highConf: ConfidenceValue = { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } };
    const lowConf: ConfidenceValue = { type: 'measured', value: 0.6, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } };

    const first = createTestConstruction('first', 'First', (n: number) => n, highConf);
    const second = createTestConstruction<ConstructionResult & { data: number }, number>(
      'second',
      'Second',
      (input) => input.data,
      lowConf
    );

    const sequenced = sequence(first, second);
    const result = await sequenced.execute(1);

    expect(getNumericValue(result.confidence)).toBe(0.6);
  });

  it('should collect evidence from both constructions', async () => {
    const first = createTestConstruction('first', 'First', (n: number) => n);
    const second = createTestConstruction<ConstructionResult & { data: number }, number>(
      'second',
      'Second',
      (input) => input.data
    );

    const sequenced = sequence(first, second);
    const result = await sequenced.execute(1);

    expect(result.evidenceRefs).toContain('first:executed');
    expect(result.evidenceRefs).toContain('second:executed');
    expect(result.evidenceRefs.some(e => e.includes('sequence:step_1'))).toBe(true);
    expect(result.evidenceRefs.some(e => e.includes('sequence:step_2'))).toBe(true);
  });

  it('should propagate errors from first construction', async () => {
    const first = createFailingConstruction('first', 'First failed');
    const second = createTestConstruction<ConstructionResult, number>(
      'second',
      'Second',
      () => 42
    );

    const sequenced = sequence(first, second);
    await expect(sequenced.execute(1)).rejects.toThrow('First failed');
  });

  it('should generate correct id and name', () => {
    const first = createTestConstruction('first', 'First', (n: number) => n);
    const second = createTestConstruction<ConstructionResult & { data: number }, number>(
      'second',
      'Second',
      (input) => input.data
    );

    const sequenced = sequence(first, second);

    expect(sequenced.id).toBe('sequence:first>second');
    expect(sequenced.name).toBe('Sequence(First, Second)');
  });

  it('should provide estimated confidence', () => {
    const first = createTestConstruction('first', 'First', (n: number) => n, deterministic(true, 'a'));
    const second = createTestConstruction<ConstructionResult & { data: number }, number>(
      'second',
      'Second',
      (input) => input.data,
      { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } }
    );

    const sequenced = sequence(first, second);
    const estimate = sequenced.getEstimatedConfidence();

    expect(getNumericValue(estimate)).toBe(0.8);
  });
});

// ============================================================================
// PARALLEL CONSTRUCTION TESTS
// ============================================================================

describe('ParallelConstruction', () => {
  it('should execute all constructions in parallel', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n * 2),
      createTestConstruction('b', 'B', (n: number) => n + 10),
      createTestConstruction('c', 'C', (n: number) => n - 1),
    ];

    const parallelC = parallel(constructions);
    const result = await parallelC.execute(5);

    expect(result.results).toHaveLength(3);
    expect(result.results[0].data).toBe(10);
    expect(result.results[1].data).toBe(15);
    expect(result.results[2].data).toBe(4);
  });

  it('should propagate confidence using product (D3) in all mode', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n, { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } }),
      createTestConstruction('b', 'B', (n: number) => n, { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } }),
    ];

    const parallelC = new ParallelConstruction(constructions, 'all');
    const result = await parallelC.execute(1);

    expect(getNumericValue(result.confidence)).toBeCloseTo(0.72, 5);
  });

  it('should propagate confidence using noisy-or (D4) in any mode', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n, { type: 'measured', value: 0.6, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } }),
      createTestConstruction('b', 'B', (n: number) => n, { type: 'measured', value: 0.7, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.7, confidenceInterval: [0.65, 0.75], measuredAt: new Date().toISOString() } }),
    ];

    const parallelC = new ParallelConstruction(constructions, 'any');
    const result = await parallelC.execute(1);

    // 1 - (0.4 * 0.3) = 0.88
    expect(getNumericValue(result.confidence)).toBeCloseTo(0.88, 5);
  });

  it('should collect branch confidences', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n, deterministic(true, 'a')),
      createTestConstruction('b', 'B', (n: number) => n, { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } }),
    ];

    const parallelC = parallel(constructions);
    const result = await parallelC.execute(1);

    expect(result.branchConfidences).toHaveLength(2);
    expect(getNumericValue(result.branchConfidences[0])).toBe(1.0);
    expect(getNumericValue(result.branchConfidences[1])).toBe(0.8);
  });

  it('should collect evidence from all branches', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n),
      createTestConstruction('b', 'B', (n: number) => n),
    ];

    const parallelC = parallel(constructions);
    const result = await parallelC.execute(1);

    expect(result.evidenceRefs).toContain('a:executed');
    expect(result.evidenceRefs).toContain('b:executed');
    expect(result.evidenceRefs.some(e => e.includes('parallel:branch_0'))).toBe(true);
    expect(result.evidenceRefs.some(e => e.includes('parallel:branch_1'))).toBe(true);
  });

  it('should generate correct id and name', () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n),
      createTestConstruction('b', 'B', (n: number) => n),
    ];

    const parallelC = parallel(constructions);

    expect(parallelC.id).toBe('parallel:a|b');
    expect(parallelC.name).toBe('Parallel(A, B)');
  });
});

// ============================================================================
// CONDITIONAL CONSTRUCTION TESTS
// ============================================================================

describe('ConditionalConstruction', () => {
  it('should execute ifTrue branch when predicate is true', async () => {
    const ifTrue = createTestConstruction('true', 'IfTrue', (n: number) => n * 2);
    const ifFalse = createTestConstruction('false', 'IfFalse', (n: number) => n + 100);

    const cond = conditional(
      (n: number) => n > 0,
      ifTrue,
      ifFalse
    );

    const result = await cond.execute(5);

    expect(result.result.data).toBe(10);
    expect(result.branchTaken).toBe('true');
  });

  it('should execute ifFalse branch when predicate is false', async () => {
    const ifTrue = createTestConstruction('true', 'IfTrue', (n: number) => n * 2);
    const ifFalse = createTestConstruction('false', 'IfFalse', (n: number) => n + 100);

    const cond = conditional(
      (n: number) => n > 0,
      ifTrue,
      ifFalse
    );

    const result = await cond.execute(-5);

    expect(result.result.data).toBe(95);
    expect(result.branchTaken).toBe('false');
  });

  it('should support async predicates', async () => {
    const ifTrue = createTestConstruction('true', 'IfTrue', (n: number) => 'yes');
    const ifFalse = createTestConstruction('false', 'IfFalse', (n: number) => 'no');

    const cond = conditional(
      async (n: number) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return n % 2 === 0;
      },
      ifTrue,
      ifFalse
    );

    const evenResult = await cond.execute(4);
    const oddResult = await cond.execute(3);

    expect(evenResult.result.data).toBe('yes');
    expect(oddResult.result.data).toBe('no');
  });

  it('should propagate confidence from executed branch', async () => {
    const highConf: ConfidenceValue = { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } };
    const lowConf: ConfidenceValue = { type: 'measured', value: 0.5, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.5, confidenceInterval: [0.45, 0.55], measuredAt: new Date().toISOString() } };

    const ifTrue = createTestConstruction('true', 'IfTrue', (n: number) => n, highConf);
    const ifFalse = createTestConstruction('false', 'IfFalse', (n: number) => n, lowConf);

    const cond = conditional(
      (n: number) => n > 0,
      ifTrue,
      ifFalse
    );

    const trueResult = await cond.execute(1);
    const falseResult = await cond.execute(-1);

    expect(getNumericValue(trueResult.confidence)).toBe(0.9);
    expect(getNumericValue(falseResult.confidence)).toBe(0.5);
  });

  it('should record predicate result in evidence', async () => {
    const ifTrue = createTestConstruction('true', 'IfTrue', (n: number) => n);
    const ifFalse = createTestConstruction('false', 'IfFalse', (n: number) => n);

    const cond = conditional(
      (n: number) => n > 0,
      ifTrue,
      ifFalse
    );

    const result = await cond.execute(1);

    expect(result.evidenceRefs.some(e => e.includes('conditional:predicate:true'))).toBe(true);
  });

  it('should use max for estimated confidence', () => {
    const highConf: ConfidenceValue = { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } };
    const lowConf: ConfidenceValue = { type: 'measured', value: 0.5, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.5, confidenceInterval: [0.45, 0.55], measuredAt: new Date().toISOString() } };

    const ifTrue = createTestConstruction('true', 'IfTrue', (n: number) => n, highConf);
    const ifFalse = createTestConstruction('false', 'IfFalse', (n: number) => n, lowConf);

    const cond = conditional(
      () => true,
      ifTrue,
      ifFalse
    );

    const estimate = cond.getEstimatedConfidence();
    expect(getNumericValue(estimate)).toBe(0.9);
  });
});

// ============================================================================
// RETRY CONSTRUCTION TESTS
// ============================================================================

describe('RetryConstruction', () => {
  it('should succeed on first attempt without retry', async () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n * 2);
    const retried = withRetry(construction, { maxAttempts: 3, baseDelayMs: 10 });

    const result = await retried.execute(5);

    expect(result.result.data).toBe(10);
    expect(result.attempts).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should retry on failure and succeed', async () => {
    let attempts = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'flaky',
      name: 'Flaky',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        attempts++;
        if (attempts < 3) {
          throw new Error('Not yet');
        }
        return {
          data: input * 2,
          confidence: deterministic(true, 'success'),
          evidenceRefs: toEvidenceIds(['flaky:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const retried = withRetry(construction, { maxAttempts: 5, baseDelayMs: 10 });
    const result = await retried.execute(5);

    expect(result.result.data).toBe(10);
    expect(result.attempts).toBe(3);
    expect(result.errors).toHaveLength(2);
  });

  it('should fail after exhausting retries', async () => {
    const failing = createFailingConstruction('fail', 'Always fails');
    const retried = withRetry(failing, { maxAttempts: 3, baseDelayMs: 10 });

    await expect(retried.execute(1)).rejects.toThrow(ConstructionError);
    await expect(retried.execute(1)).rejects.toThrow('Retry failed after 3 attempts');
  });

  it('should respect isRetryable predicate', async () => {
    const failing = createFailingConstruction('fail', 'Non-retryable error');
    const retried = withRetry(failing, {
      maxAttempts: 5,
      baseDelayMs: 10,
      isRetryable: () => false,
    });

    await expect(retried.execute(1)).rejects.toThrow(ConstructionError);
  });

  it('should record retry attempts in evidence', async () => {
    let attempts = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'flaky',
      name: 'Flaky',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        attempts++;
        if (attempts < 2) {
          throw new Error('Not yet');
        }
        return {
          data: input,
          confidence: deterministic(true, 'success'),
          evidenceRefs: toEvidenceIds(['flaky:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const retried = withRetry(construction, { maxAttempts: 3, baseDelayMs: 10 });
    const result = await retried.execute(1);

    expect(result.evidenceRefs.filter(e => e.includes('retry:attempt'))).toHaveLength(2);
    expect(result.evidenceRefs.some(e => e.includes('retry:error'))).toBe(true);
  });

  it('should apply exponential backoff', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'flaky',
      name: 'Flaky',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        attempts++;
        if (attempts < 3) {
          throw new Error('Not yet');
        }
        return {
          data: input,
          confidence: deterministic(true, 'success'),
          evidenceRefs: toEvidenceIds([]),
          analysisTimeMs: 1,
        };
      },
    };

    const retried = withRetry(construction, {
      maxAttempts: 5,
      baseDelayMs: 100,
      backoffFactor: 2,
    });

    const resultPromise = retried.execute(1);

    // First attempt fails immediately
    await vi.advanceTimersByTimeAsync(0);
    // Wait for first backoff (100ms)
    await vi.advanceTimersByTimeAsync(100);
    // Second attempt fails, wait for second backoff (200ms)
    await vi.advanceTimersByTimeAsync(200);
    // Third attempt should succeed

    const result = await resultPromise;
    expect(result.attempts).toBe(3);

    vi.useRealTimers();
  });
});

// ============================================================================
// TIMEOUT CONSTRUCTION TESTS
// ============================================================================

describe('TimeoutConstruction', () => {
  it('should complete before timeout', async () => {
    const construction = createTestConstruction('fast', 'Fast', (n: number) => n * 2);
    const timed = withTimeout(construction, 1000);

    const result = await timed.execute(5);

    expect(result.data).toBe(10);
  });

  it('should throw on timeout', async () => {
    const slow = createSlowConstruction('slow', 200, {
      data: 'never',
      confidence: deterministic(true, 'slow'),
      evidenceRefs: toEvidenceIds([]),
      analysisTimeMs: 200,
    });

    const timed = withTimeout(slow, 50);

    await expect(timed.execute(1)).rejects.toThrow(ConstructionTimeoutError);
  });

  it('should include timeout duration in error', async () => {
    const slow = createSlowConstruction('slow', 200, {
      data: 'never',
      confidence: deterministic(true, 'slow'),
      evidenceRefs: toEvidenceIds([]),
      analysisTimeMs: 200,
    });

    const timed = withTimeout(slow, 50);

    try {
      await timed.execute(1);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConstructionTimeoutError);
      expect((error as ConstructionTimeoutError).timeoutMs).toBe(50);
    }
  });

  it('should generate correct id and name', () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n);
    const timed = withTimeout(construction, 1000);

    expect(timed.id).toBe('timeout:test');
    expect(timed.name).toBe('Timeout(Test, 1000ms)');
  });
});

describe('Context threading and cancellation', () => {
  it('threads execution context through sequence steps', async () => {
    let seenByFirst: Context<unknown> | undefined;
    let seenBySecond: Context<unknown> | undefined;

    const first: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'ctx-first',
      name: 'Ctx First',
      async execute(input: number, context?: Context<unknown>) {
        seenByFirst = context;
        return {
          data: input + 1,
          confidence: deterministic(true, 'ctx-first'),
          evidenceRefs: toEvidenceIds(['ctx-first:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const second: ComposableConstruction<ConstructionResult & { data: number }, ConstructionResult & { data: number }> = {
      id: 'ctx-second',
      name: 'Ctx Second',
      async execute(input, context?: Context<unknown>) {
        seenBySecond = context;
        return {
          data: input.data + 2,
          confidence: deterministic(true, 'ctx-second'),
          evidenceRefs: toEvidenceIds(['ctx-second:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const controller = new AbortController();
    const context: Context<unknown> = {
      deps: {},
      signal: controller.signal,
      sessionId: 'ctx-seq-session',
      tokenBudget: 321,
      traceContext: { traceId: 'trace-1' },
    };

    const composed = sequence(first, second);
    const output = await composed.execute(10, context);

    expect(output.data).toBe(13);
    expect(seenByFirst?.sessionId).toBe('ctx-seq-session');
    expect(seenBySecond?.sessionId).toBe('ctx-seq-session');
    expect(seenByFirst?.signal).toBe(context.signal);
    expect(seenBySecond?.signal).toBe(context.signal);
  });

  it('aborts a 3-step sequence in step 2 and never executes step 3', async () => {
    let step3Calls = 0;

    const step1 = createTestConstruction('cancel-step1', 'Cancel Step 1', (n: number) => n + 1);

    const step2: ComposableConstruction<ConstructionResult & { data: number }, ConstructionResult & { data: number }> = {
      id: 'cancel-step2',
      name: 'Cancel Step 2',
      async execute(input, context?: Context<unknown>) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          const onAbort = (): void => {
            clearTimeout(timer);
            reject(new ConstructionCancelledError('cancel-step2'));
          };
          if (context?.signal.aborted) {
            onAbort();
            return;
          }
          context?.signal.addEventListener('abort', onAbort, { once: true });
        });

        return {
          data: input.data + 1,
          confidence: deterministic(true, 'cancel-step2'),
          evidenceRefs: toEvidenceIds(['cancel-step2:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const step3: ComposableConstruction<ConstructionResult & { data: number }, ConstructionResult & { data: number }> = {
      id: 'cancel-step3',
      name: 'Cancel Step 3',
      async execute(input) {
        step3Calls++;
        return {
          data: input.data + 1,
          confidence: deterministic(true, 'cancel-step3'),
          evidenceRefs: toEvidenceIds(['cancel-step3:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const composed = sequence(sequence(step1, step2), step3);
    const controller = new AbortController();
    const context: Context<unknown> = {
      deps: {},
      signal: controller.signal,
      sessionId: 'cancel-session',
    };

    const execution = composed.execute(1, context);
    setTimeout(() => controller.abort(), 50);

    await expect(execution).rejects.toThrow(ConstructionCancelledError);
    expect(step3Calls).toBe(0);
  });

  it('withTimeout forwards parent abort cancellation to the wrapped construction', async () => {
    const slow: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'cancel-timeout-slow',
      name: 'Cancel Timeout Slow',
      async execute(input: number, context?: Context<unknown>) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 500);
          const onAbort = (): void => {
            clearTimeout(timer);
            reject(new ConstructionCancelledError('cancel-timeout-slow'));
          };
          if (context?.signal.aborted) {
            onAbort();
            return;
          }
          context?.signal.addEventListener('abort', onAbort, { once: true });
        });

        return {
          data: input,
          confidence: deterministic(true, 'cancel-timeout-slow'),
          evidenceRefs: toEvidenceIds(['cancel-timeout-slow:executed']),
          analysisTimeMs: 1,
        };
      },
    };

    const timed = withTimeout(slow, 1000);
    const controller = new AbortController();
    const execution = timed.execute(9, {
      deps: {},
      signal: controller.signal,
      sessionId: 'cancel-timeout',
    });

    setTimeout(() => controller.abort(), 50);
    await expect(execution).rejects.toThrow(ConstructionCancelledError);
  });
});

// ============================================================================
// CACHED CONSTRUCTION TESTS
// ============================================================================

describe('CachedConstruction', () => {
  it('should cache results', async () => {
    let callCount = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'expensive',
      name: 'Expensive',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        callCount++;
        return {
          data: input * callCount,
          confidence: deterministic(true, 'cached'),
          evidenceRefs: toEvidenceIds([`call:${callCount}`]),
          analysisTimeMs: 1,
        };
      },
    };

    const cached = withCache(construction, { ttlMs: 1000 });

    const result1 = await cached.execute(5);
    const result2 = await cached.execute(5);

    expect(result1.data).toBe(5); // 5 * 1
    expect(result2.data).toBe(5); // cached
    expect(callCount).toBe(1);
  });

  it('should record cache hit/miss in evidence', async () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n);
    const cached = withCache(construction, { ttlMs: 1000 });

    const result1 = await cached.execute(1);
    const result2 = await cached.execute(1);

    expect(result1.evidenceRefs.some(e => e.includes('cache:miss'))).toBe(true);
    expect(result2.evidenceRefs.some(e => e.includes('cache:hit'))).toBe(true);
  });

  it('should expire cache after TTL', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'timed',
      name: 'Timed',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        callCount++;
        return {
          data: callCount,
          confidence: deterministic(true, 'timed'),
          evidenceRefs: toEvidenceIds([]),
          analysisTimeMs: 1,
        };
      },
    };

    const cached = withCache(construction, { ttlMs: 100 });

    await cached.execute(1);
    expect(callCount).toBe(1);

    await cached.execute(1);
    expect(callCount).toBe(1); // Still cached

    await vi.advanceTimersByTimeAsync(150);

    await cached.execute(1);
    expect(callCount).toBe(2); // Cache expired

    vi.useRealTimers();
  });

  it('should respect maxEntries', async () => {
    let callCount = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'limited',
      name: 'Limited',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        callCount++;
        return {
          data: input,
          confidence: deterministic(true, 'limited'),
          evidenceRefs: toEvidenceIds([]),
          analysisTimeMs: 1,
        };
      },
    };

    const cached = withCache(construction, { ttlMs: 10000, maxEntries: 2 });

    // Phase 1: Fill cache and cause eviction
    await cached.execute(1);
    await cached.execute(2);
    await cached.execute(3); // Should evict 1

    // Verify cache size is at max (2 entries: 2 and 3)
    expect(cached.getCacheStats().size).toBe(2);

    callCount = 0;

    // Entries 2 and 3 should be cache hits (no underlying execution)
    await cached.execute(2); // Should hit
    await cached.execute(3); // Should hit

    expect(callCount).toBe(0); // Both were cache hits

    // Entry 1 was evicted, so it should miss and execute
    await cached.execute(1); // Should miss (was evicted), will evict 2 when caching result

    expect(callCount).toBe(1); // One miss for entry 1
  });

  it('should support custom key generator', async () => {
    const construction = createTestConstruction('test', 'Test', (obj: { id: number; extra: string }) => obj.id);
    const cached = withCache(construction, {
      ttlMs: 1000,
      keyGenerator: (input) => (input as { id: number }).id.toString(),
    });

    const result1 = await cached.execute({ id: 1, extra: 'a' });
    const result2 = await cached.execute({ id: 1, extra: 'b' }); // Different extra, same id

    expect(result2.evidenceRefs.some(e => e.includes('cache:hit'))).toBe(true);
  });

  it('should provide cache stats', async () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n);
    const cached = withCache(construction, { ttlMs: 1000, maxEntries: 10 });

    await cached.execute(1);
    await cached.execute(2);

    const stats = cached.getCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.maxEntries).toBe(10);
    expect(stats.ttlMs).toBe(1000);
  });

  it('should clear cache', async () => {
    let callCount = 0;
    const construction: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'clearable',
      name: 'Clearable',
      async execute(): Promise<ConstructionResult & { data: number }> {
        callCount++;
        return {
          data: callCount,
          confidence: deterministic(true, 'clearable'),
          evidenceRefs: toEvidenceIds([]),
          analysisTimeMs: 1,
        };
      },
    };

    const cached = withCache(construction, { ttlMs: 10000 });

    await cached.execute(1);
    expect(callCount).toBe(1);

    cached.clearCache();

    await cached.execute(1);
    expect(callCount).toBe(2);
  });
});

// ============================================================================
// TRACED CONSTRUCTION TESTS
// ============================================================================

describe('TracedConstruction', () => {
  it('should create span for execution', async () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n);
    const tracer = createMockTracer();
    const traced = withTracing(construction, tracer);

    await traced.execute(1);

    expect(tracer.spans.size).toBe(1);
    const span = Array.from(tracer.spans.values())[0];
    expect(span.name).toBe('Test');
    expect(span.ended).toBe(true);
  });

  it('should record success events and attributes', async () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n);
    const tracer = createMockTracer();
    const traced = withTracing(construction, tracer);

    await traced.execute(1);

    const span = Array.from(tracer.spans.values())[0];
    expect(span.events.some(e => e.name === 'execution_started')).toBe(true);
    expect(span.events.some(e => e.name === 'execution_completed')).toBe(true);
    expect(span.attributes['status']).toBe('success');
  });

  it('should record error events on failure', async () => {
    const failing = createFailingConstruction('fail', 'Test error');
    const tracer = createMockTracer();
    const traced = withTracing(failing, tracer);

    await expect(traced.execute(1)).rejects.toThrow('Test error');

    const span = Array.from(tracer.spans.values())[0];
    expect(span.events.some(e => e.name === 'execution_failed')).toBe(true);
    expect(span.attributes['status']).toBe('error');
    expect(span.attributes['error']).toBe('Test error');
    expect(span.ended).toBe(true);
  });

  it('should add span ID to evidence', async () => {
    const construction = createTestConstruction('test', 'Test', (n: number) => n);
    const tracer = createMockTracer();
    const traced = withTracing(construction, tracer);

    const result = await traced.execute(1);

    expect(result.evidenceRefs.some(e => e.startsWith('trace:span_'))).toBe(true);
  });

  it('should include construction metadata in span', async () => {
    const construction = createTestConstruction('my-id', 'My Construction', (n: number) => n);
    const tracer = createMockTracer();
    const traced = withTracing(construction, tracer);

    await traced.execute(42);

    const span = Array.from(tracer.spans.values())[0];
    expect(span.attributes['constructionId']).toBe('my-id');
    expect(span.attributes['inputType']).toBe('number');
  });
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  describe('createConstruction', () => {
    it('should create a composable construction', async () => {
      const construction = createConstruction(
        'my-id',
        'My Construction',
        async (input: number) => ({
          data: input * 2,
          confidence: deterministic(true, 'test'),
        })
      );

      expect(construction.id).toBe('my-id');
      expect(construction.name).toBe('My Construction');

      const result = await construction.execute(5);
      expect(result.data).toBe(10);
      expect(result.confidence.type).toBe('deterministic');
    });

    it('should track execution time', async () => {
      const construction = createConstruction(
        'slow',
        'Slow',
        async (input: number) => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return {
            data: input,
            confidence: deterministic(true, 'slow'),
          };
        }
      );

      const result = await construction.execute(1);
      expect(result.analysisTimeMs).toBeGreaterThanOrEqual(45);
    });

    it('should include provided evidence refs', async () => {
      const construction = createConstruction(
        'test',
        'Test',
        async () => ({
          data: 42,
          confidence: deterministic(true, 'test'),
          evidenceRefs: toEvidenceIds(['custom:evidence']),
        })
      );

      const result = await construction.execute(1);
      expect(result.evidenceRefs).toContain('custom:evidence');
    });
  });

  describe('createDeterministicConstruction', () => {
    it('should create a construction with deterministic confidence', async () => {
      const construction = createDeterministicConstruction(
        'deterministic',
        'Deterministic',
        (n: number) => n.toString()
      );

      const result = await construction.execute(42);

      expect(result.data).toBe('42');
      expect(result.confidence.type).toBe('deterministic');
      expect(getNumericValue(result.confidence)).toBe(1.0);
    });
  });

  describe('constant', () => {
    it('should always return the same result', async () => {
      const fixedResult: ConstructionResult & { data: string } = {
        data: 'constant',
        confidence: deterministic(true, 'constant'),
        evidenceRefs: toEvidenceIds(['constant:always']),
        analysisTimeMs: 0,
      };

      const construction = constant('const', 'Constant', fixedResult);

      const result1 = await construction.execute(1);
      const result2 = await construction.execute('different');
      const result3 = await construction.execute({ any: 'thing' });

      expect(result1.data).toBe('constant');
      expect(result2.data).toBe('constant');
      expect(result3.data).toBe('constant');
    });

    it('should provide estimated confidence', () => {
      const fixedResult: ConstructionResult & { data: number } = {
        data: 42,
        confidence: { type: 'measured', value: 0.8, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } },
        evidenceRefs: toEvidenceIds([]),
        analysisTimeMs: 0,
      };

      const construction = constant('const', 'Constant', fixedResult);

      const estimate = construction.getEstimatedConfidence!();
      expect(getNumericValue(estimate)).toBe(0.8);
    });
  });
});

// ============================================================================
// PIPELINE BUILDER TESTS
// ============================================================================

describe('PipelineBuilder', () => {
  it('should build a sequential pipeline', async () => {
    const first = createTestConstruction('first', 'First', (n: number) => n * 2);
    const second = createTestConstruction<ConstructionResult & { data: number }, number>(
      'second',
      'Second',
      (input) => input.data + 10
    );

    const built = pipeline(first).then(second).build();
    const result = await built.execute(5);

    expect(result.data).toBe(20);
  });

  it('should support chaining multiple decorators', async () => {
    const construction = createTestConstruction('base', 'Base', (n: number) => n * 2);
    const tracer = createMockTracer();

    const built = pipeline(construction)
      .withTimeout(5000)
      .withCache({ ttlMs: 1000 })
      .withTracing(tracer)
      .build();

    const result = await built.execute(5);

    expect(result.data).toBe(10);
    expect(tracer.spans.size).toBe(1);
  });

  it('should support retry in pipeline', async () => {
    let attempts = 0;
    const flaky: ComposableConstruction<number, ConstructionResult & { data: number }> = {
      id: 'flaky',
      name: 'Flaky',
      async execute(input: number): Promise<ConstructionResult & { data: number }> {
        attempts++;
        if (attempts < 2) {
          throw new Error('Flaky');
        }
        return {
          data: input * 2,
          confidence: deterministic(true, 'success'),
          evidenceRefs: toEvidenceIds([]),
          analysisTimeMs: 1,
        };
      },
    };

    const built = pipeline(flaky)
      .withRetry({ maxAttempts: 3, baseDelayMs: 10 })
      .build();

    const result = await built.execute(5);

    expect(result.result.data).toBe(10);
    expect(result.attempts).toBe(2);
  });
});

// ============================================================================
// PARALLEL BUILDER TESTS
// ============================================================================

describe('ParallelBuilder', () => {
  it('should build parallel construction with all mode', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n * 2, { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } }),
      createTestConstruction('b', 'B', (n: number) => n + 10, { type: 'measured', value: 0.8, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.8, confidenceInterval: [0.75, 0.85], measuredAt: new Date().toISOString() } }),
    ];

    const built = parallelBuilder(constructions).requireAll().build();
    const result = await built.execute(5);

    // Product: 0.9 * 0.8 = 0.72
    expect(getNumericValue(result.confidence)).toBeCloseTo(0.72, 5);
  });

  it('should build parallel construction with any mode', async () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n * 2, { type: 'measured', value: 0.6, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.6, confidenceInterval: [0.55, 0.65], measuredAt: new Date().toISOString() } }),
      createTestConstruction('b', 'B', (n: number) => n + 10, { type: 'measured', value: 0.7, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.7, confidenceInterval: [0.65, 0.75], measuredAt: new Date().toISOString() } }),
    ];

    const built = parallelBuilder(constructions).requireAny().build();
    const result = await built.execute(5);

    // Noisy-or: 1 - (0.4 * 0.3) = 0.88
    expect(getNumericValue(result.confidence)).toBeCloseTo(0.88, 5);
  });

  it('should allow chaining mode methods', () => {
    const constructions = [
      createTestConstruction('a', 'A', (n: number) => n),
    ];

    const builder = parallelBuilder(constructions)
      .requireAll()
      .requireAny()
      .requireAll();

    const built = builder.build();
    expect(built).toBeInstanceOf(ParallelConstruction);
  });
});

// ============================================================================
// COMPLEX COMPOSITION TESTS
// ============================================================================

describe('Complex Compositions', () => {
  it('should compose sequence inside parallel', async () => {
    const seq1 = sequence(
      createTestConstruction('a1', 'A1', (n: number) => n * 2),
      createTestConstruction<ConstructionResult & { data: number }, number>('a2', 'A2', (input) => input.data + 1)
    );

    const seq2 = sequence(
      createTestConstruction('b1', 'B1', (n: number) => n + 10),
      createTestConstruction<ConstructionResult & { data: number }, number>('b2', 'B2', (input) => input.data * 3)
    );

    const par = parallel([seq1, seq2]);
    const result = await par.execute(5);

    expect(result.results[0].data).toBe(11); // 5*2=10, 10+1=11
    expect(result.results[1].data).toBe(45); // 5+10=15, 15*3=45
  });

  it('should compose parallel inside sequence', async () => {
    const par = parallel([
      createTestConstruction('a', 'A', (n: number) => n * 2),
      createTestConstruction('b', 'B', (n: number) => n + 10),
    ]);

    type ParResult = Awaited<ReturnType<typeof par.execute>>;
    const sum = createTestConstruction<ParResult, number>(
      'sum',
      'Sum',
      (input) => input.results.reduce((acc, r) => acc + (r as { data: number }).data, 0)
    );

    const composed = sequence(par, sum);
    const result = await composed.execute(5);

    expect(result.data).toBe(25); // 10 + 15
  });

  it('should compose conditional with parallel', async () => {
    const expensive = parallel([
      createTestConstruction('exp1', 'Expensive1', (n: number) => n * 100),
      createTestConstruction('exp2', 'Expensive2', (n: number) => n * 200),
    ]);

    const cheap = createTestConstruction('cheap', 'Cheap', (n: number) => ({ results: [{ data: n }], branchConfidences: [] }));

    const cond = conditional(
      (n: number) => n > 10,
      expensive as unknown as ComposableConstruction<number, ConstructionResult & { results: unknown[] }>,
      cheap as unknown as ComposableConstruction<number, ConstructionResult & { results: unknown[] }>
    );

    const expensiveResult = await cond.execute(20);
    const cheapResult = await cond.execute(5);

    expect(expensiveResult.branchTaken).toBe('true');
    expect(cheapResult.branchTaken).toBe('false');
  });

  it('should apply decorators to composed constructions', async () => {
    const seq = sequence(
      createTestConstruction('a', 'A', (n: number) => n * 2),
      createTestConstruction<ConstructionResult & { data: number }, number>('b', 'B', (input) => input.data + 1)
    );

    const tracer = createMockTracer();
    const decorated = pipeline(seq)
      .withTimeout(5000)
      .withCache({ ttlMs: 1000 })
      .withTracing(tracer)
      .build();

    const result = await decorated.execute(5);

    expect(result.data).toBe(11);
    expect(tracer.spans.size).toBe(1);
  });

  it('should propagate confidence through nested compositions', async () => {
    const highConf: ConfidenceValue = { type: 'measured', value: 0.9, measurement: { datasetId: 'a', sampleSize: 100, accuracy: 0.9, confidenceInterval: [0.85, 0.95], measuredAt: new Date().toISOString() } };
    const lowConf: ConfidenceValue = { type: 'measured', value: 0.7, measurement: { datasetId: 'b', sampleSize: 100, accuracy: 0.7, confidenceInterval: [0.65, 0.75], measuredAt: new Date().toISOString() } };

    const seq = sequence(
      createTestConstruction('a', 'A', (n: number) => n, highConf),
      createTestConstruction<ConstructionResult & { data: number }, number>('b', 'B', (input) => input.data, lowConf)
    );

    // Sequence uses min, so should be 0.7
    const seqResult = await seq.execute(1);
    expect(getNumericValue(seqResult.confidence)).toBe(0.7);

    const par = parallel([seq, createTestConstruction('c', 'C', (n: number) => n, highConf)]);

    // Parallel uses product: 0.7 * 0.9 = 0.63
    const parResult = await par.execute(1);
    expect(getNumericValue(parResult.confidence)).toBeCloseTo(0.63, 5);
  });
});
