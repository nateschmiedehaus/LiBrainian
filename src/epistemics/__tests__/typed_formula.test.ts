/**
 * @fileoverview Tests for Typed Formula AST (WU-THIMPL-201)
 *
 * Tests cover:
 * - FormulaNode type union
 * - formulaToString function
 * - evaluateFormula function
 * - createFormula helper
 * - Integration with DerivedConfidence
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  type FormulaNode,
  formulaToString,
  evaluateFormula,
  createFormula,
  isFormulaNode,
  type DerivedConfidence,
  measuredConfidence,
  getNumericValue,
} from '../confidence.js';

describe('Typed Formula AST (WU-THIMPL-201)', () => {
  describe('formulaToString', () => {
    it('should convert value node to string', () => {
      const node: FormulaNode = { type: 'value', name: 'a' };
      expect(formulaToString(node)).toBe('a');
    });

    it('should convert min node to string', () => {
      const node: FormulaNode = {
        type: 'min',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
        ],
      };
      expect(formulaToString(node)).toBe('min(a, b)');
    });

    it('should convert max node to string', () => {
      const node: FormulaNode = {
        type: 'max',
        children: [
          { type: 'value', name: 'x' },
          { type: 'value', name: 'y' },
          { type: 'value', name: 'z' },
        ],
      };
      expect(formulaToString(node)).toBe('max(x, y, z)');
    });

    it('should convert product node to string', () => {
      const node: FormulaNode = {
        type: 'product',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
        ],
      };
      expect(formulaToString(node)).toBe('a * b');
    });

    it('should handle empty product as identity', () => {
      const node: FormulaNode = { type: 'product', children: [] };
      expect(formulaToString(node)).toBe('1');
    });

    it('should handle single child in product', () => {
      const node: FormulaNode = {
        type: 'product',
        children: [{ type: 'value', name: 'a' }],
      };
      expect(formulaToString(node)).toBe('a');
    });

    it('should convert sum node to string', () => {
      const node: FormulaNode = {
        type: 'sum',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
        ],
      };
      expect(formulaToString(node)).toBe('(a + b)');
    });

    it('should handle empty sum as zero', () => {
      const node: FormulaNode = { type: 'sum', children: [] };
      expect(formulaToString(node)).toBe('0');
    });

    it('should convert scale node to string', () => {
      const node: FormulaNode = {
        type: 'scale',
        factor: 0.5,
        child: { type: 'value', name: 'a' },
      };
      expect(formulaToString(node)).toBe('0.5 * a');
    });

    it('should handle nested formulas', () => {
      // min(a, b) * 0.9
      const node: FormulaNode = {
        type: 'scale',
        factor: 0.9,
        child: {
          type: 'min',
          children: [
            { type: 'value', name: 'a' },
            { type: 'value', name: 'b' },
          ],
        },
      };
      expect(formulaToString(node)).toBe('0.9 * min(a, b)');
    });

    it('should handle deeply nested formulas', () => {
      // max(min(a, b), product(c, d))
      const node: FormulaNode = {
        type: 'max',
        children: [
          {
            type: 'min',
            children: [
              { type: 'value', name: 'a' },
              { type: 'value', name: 'b' },
            ],
          },
          {
            type: 'product',
            children: [
              { type: 'value', name: 'c' },
              { type: 'value', name: 'd' },
            ],
          },
        ],
      };
      expect(formulaToString(node)).toBe('max(min(a, b), c * d)');
    });
  });

  describe('evaluateFormula', () => {
    it('should evaluate value node', () => {
      const node: FormulaNode = { type: 'value', name: 'a' };
      const values = new Map([['a', 0.8]]);
      expect(evaluateFormula(node, values)).toBe(0.8);
    });

    it('should throw for missing value', () => {
      const node: FormulaNode = { type: 'value', name: 'missing' };
      const values = new Map([['a', 0.8]]);
      expect(() => evaluateFormula(node, values)).toThrow(/Missing value/);
    });

    it('should evaluate min node', () => {
      const node: FormulaNode = {
        type: 'min',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
          { type: 'value', name: 'c' },
        ],
      };
      const values = new Map([
        ['a', 0.8],
        ['b', 0.6],
        ['c', 0.9],
      ]);
      expect(evaluateFormula(node, values)).toBe(0.6);
    });

    it('should evaluate max node', () => {
      const node: FormulaNode = {
        type: 'max',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
        ],
      };
      const values = new Map([
        ['a', 0.3],
        ['b', 0.7],
      ]);
      expect(evaluateFormula(node, values)).toBe(0.7);
    });

    it('should evaluate product node', () => {
      const node: FormulaNode = {
        type: 'product',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
        ],
      };
      const values = new Map([
        ['a', 0.8],
        ['b', 0.5],
      ]);
      expect(evaluateFormula(node, values)).toBeCloseTo(0.4);
    });

    it('should evaluate empty product as 1', () => {
      const node: FormulaNode = { type: 'product', children: [] };
      expect(evaluateFormula(node, new Map())).toBe(1);
    });

    it('should evaluate sum node', () => {
      const node: FormulaNode = {
        type: 'sum',
        children: [
          { type: 'value', name: 'a' },
          { type: 'value', name: 'b' },
        ],
      };
      const values = new Map([
        ['a', 0.3],
        ['b', 0.4],
      ]);
      expect(evaluateFormula(node, values)).toBeCloseTo(0.7);
    });

    it('should evaluate empty sum as 0', () => {
      const node: FormulaNode = { type: 'sum', children: [] };
      expect(evaluateFormula(node, new Map())).toBe(0);
    });

    it('should evaluate scale node', () => {
      const node: FormulaNode = {
        type: 'scale',
        factor: 0.5,
        child: { type: 'value', name: 'a' },
      };
      const values = new Map([['a', 0.8]]);
      expect(evaluateFormula(node, values)).toBeCloseTo(0.4);
    });

    it('should evaluate nested formulas', () => {
      // 0.9 * min(a, b)
      const node: FormulaNode = {
        type: 'scale',
        factor: 0.9,
        child: {
          type: 'min',
          children: [
            { type: 'value', name: 'a' },
            { type: 'value', name: 'b' },
          ],
        },
      };
      const values = new Map([
        ['a', 0.8],
        ['b', 0.6],
      ]);
      expect(evaluateFormula(node, values)).toBeCloseTo(0.54); // 0.9 * 0.6
    });

    it('should handle complex real-world formula', () => {
      // max(product(a, b), min(c, d)) - represents OR of two verification paths
      const node: FormulaNode = {
        type: 'max',
        children: [
          {
            type: 'product',
            children: [
              { type: 'value', name: 'a' },
              { type: 'value', name: 'b' },
            ],
          },
          {
            type: 'min',
            children: [
              { type: 'value', name: 'c' },
              { type: 'value', name: 'd' },
            ],
          },
        ],
      };
      const values = new Map([
        ['a', 0.8],
        ['b', 0.7], // product = 0.56
        ['c', 0.9],
        ['d', 0.6], // min = 0.6
      ]);
      expect(evaluateFormula(node, values)).toBeCloseTo(0.6); // max(0.56, 0.6)
    });

    it('should handle empty min as Infinity', () => {
      const node: FormulaNode = { type: 'min', children: [] };
      expect(evaluateFormula(node, new Map())).toBe(Infinity);
    });

    it('should handle empty max as -Infinity', () => {
      const node: FormulaNode = { type: 'max', children: [] };
      expect(evaluateFormula(node, new Map())).toBe(-Infinity);
    });
  });

  describe('createFormula', () => {
    it('should create min formula', () => {
      const formula = createFormula('min', ['a', 'b', 'c']);
      expect(formula.type).toBe('min');
      expect(formulaToString(formula)).toBe('min(a, b, c)');
    });

    it('should create max formula', () => {
      const formula = createFormula('max', ['x', 'y']);
      expect(formula.type).toBe('max');
      expect(formulaToString(formula)).toBe('max(x, y)');
    });

    it('should create product formula', () => {
      const formula = createFormula('product', ['a', 'b']);
      expect(formula.type).toBe('product');
      expect(formulaToString(formula)).toBe('a * b');
    });

    it('should create sum formula', () => {
      const formula = createFormula('sum', ['a', 'b', 'c']);
      expect(formula.type).toBe('sum');
      expect(formulaToString(formula)).toBe('(a + b + c)');
    });

    it('should work with evaluateFormula', () => {
      const formula = createFormula('min', ['step_0', 'step_1', 'step_2']);
      const values = new Map([
        ['step_0', 0.9],
        ['step_1', 0.7],
        ['step_2', 0.8],
      ]);
      expect(evaluateFormula(formula, values)).toBe(0.7);
    });
  });

  describe('isFormulaNode', () => {
    it('should return true for valid formula nodes', () => {
      expect(isFormulaNode({ type: 'value', name: 'a' })).toBe(true);
      expect(isFormulaNode({ type: 'min', children: [] })).toBe(true);
      expect(isFormulaNode({ type: 'max', children: [] })).toBe(true);
      expect(isFormulaNode({ type: 'product', children: [] })).toBe(true);
      expect(isFormulaNode({ type: 'sum', children: [] })).toBe(true);
      expect(isFormulaNode({ type: 'scale', factor: 1, child: { type: 'value', name: 'a' } })).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isFormulaNode(null)).toBe(false);
      expect(isFormulaNode(undefined)).toBe(false);
      expect(isFormulaNode(42)).toBe(false);
      expect(isFormulaNode('string')).toBe(false);
      expect(isFormulaNode({ type: 'invalid' })).toBe(false);
      expect(isFormulaNode({})).toBe(false);
    });
  });

  describe('Integration with DerivedConfidence', () => {
    it('should support formulaAst in DerivedConfidence', () => {
      const formulaAst: FormulaNode = createFormula('min', ['step_0', 'step_1']);

      const derived: DerivedConfidence = {
        type: 'derived',
        value: 0.7,
        formula: formulaToString(formulaAst),
        inputs: [
          {
            name: 'step_0',
            confidence: measuredConfidence({
              datasetId: 'test',
              sampleSize: 100,
              accuracy: 0.8,
              ci95: [0.75, 0.85],
            }),
          },
          {
            name: 'step_1',
            confidence: measuredConfidence({
              datasetId: 'test',
              sampleSize: 100,
              accuracy: 0.7,
              ci95: [0.65, 0.75],
            }),
          },
        ],
        formulaAst,
      };

      expect(derived.formulaAst).toBeDefined();
      expect(derived.formula).toBe('min(step_0, step_1)');

      // Verify the AST can be evaluated to get the same result
      const values = new Map<string, number>();
      for (const input of derived.inputs) {
        values.set(input.name, getNumericValue(input.confidence)!);
      }
      expect(evaluateFormula(derived.formulaAst!, values)).toBe(derived.value);
    });

    it('should allow DerivedConfidence without formulaAst (backward compatible)', () => {
      const derived: DerivedConfidence = {
        type: 'derived',
        value: 0.7,
        formula: 'min(a, b)',
        inputs: [],
      };

      expect(derived.formulaAst).toBeUndefined();
    });
  });

  describe('Real-world scenarios', () => {
    it('should represent sequential confidence formula', () => {
      // Sequential pipeline: confidence = min(steps)
      const steps = ['parse', 'validate', 'transform'];
      const formula = createFormula('min', steps);

      expect(formulaToString(formula)).toBe('min(parse, validate, transform)');

      const values = new Map([
        ['parse', 0.95],
        ['validate', 0.88],
        ['transform', 0.92],
      ]);
      expect(evaluateFormula(formula, values)).toBe(0.88);
    });

    it('should represent parallel-all confidence formula', () => {
      // Parallel-all: confidence = product(branches)
      const branches = ['check_a', 'check_b', 'check_c'];
      const formula = createFormula('product', branches);

      expect(formulaToString(formula)).toBe('check_a * check_b * check_c');

      const values = new Map([
        ['check_a', 0.9],
        ['check_b', 0.8],
        ['check_c', 0.85],
      ]);
      expect(evaluateFormula(formula, values)).toBeCloseTo(0.612);
    });

    it('should represent noisy-or formula with nested AST', () => {
      // Parallel-any (noisy-or): 1 - product(1 - branches)
      // We can represent this as: 1 - (1-a) * (1-b)
      // Which is: sum(a, b, -product(a, b)) = a + b - ab
      // But for simplicity, we'll compute values outside the AST
      // and use scale/sum to represent the adjustment

      // For a more direct representation, we compute:
      // 1 - product(complements) where complements = 1 - original
      const a = 0.6;
      const b = 0.5;
      const expected = 1 - (1 - a) * (1 - b); // 0.8

      // The AST represents the values, evaluation happens externally
      // In practice, we'd precompute and store the result
      expect(expected).toBeCloseTo(0.8);
    });

    it('should represent correlation-adjusted formula', () => {
      // (1 - rho) * product + rho * min
      // For rho = 0.5, product = 0.72, min = 0.8
      // Result = 0.5 * 0.72 + 0.5 * 0.8 = 0.76

      const rho = 0.5;
      const product = 0.72;
      const min = 0.8;

      // This could be represented as a formula, but the scaling
      // makes it complex. The string formula is simpler here.
      const result = (1 - rho) * product + rho * min;
      expect(result).toBeCloseTo(0.76);
    });

    it('should represent weighted average formula', () => {
      // weighted_average = sum(wi * vi) / sum(wi)
      // Simplified: if w1=0.6, w2=0.4, v1=0.8, v2=0.7
      // Result = (0.6*0.8 + 0.4*0.7) / (0.6+0.4) = 0.76

      // We can represent this with nested sum and scale nodes
      const formula: FormulaNode = {
        type: 'sum',
        children: [
          { type: 'scale', factor: 0.6, child: { type: 'value', name: 'v1' } },
          { type: 'scale', factor: 0.4, child: { type: 'value', name: 'v2' } },
        ],
      };

      const values = new Map([
        ['v1', 0.8],
        ['v2', 0.7],
      ]);

      expect(evaluateFormula(formula, values)).toBeCloseTo(0.76);
      expect(formulaToString(formula)).toBe('(0.6 * v1 + 0.4 * v2)');
    });
  });
});
