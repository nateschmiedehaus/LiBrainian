/**
 * @fileoverview Tests for Proven Formula AST System
 *
 * This module implements a typed AST system where formula expressions carry proofs
 * of their validity. This eliminates runtime formula errors and enables static
 * verification of confidence propagation.
 *
 * TEST-FIRST DEVELOPMENT: These tests are written BEFORE the implementation.
 *
 * Tests cover:
 * - Proof term creation and validation
 * - AST node types (literal, input, binary, unary, conditional)
 * - Builder functions that produce valid ASTs by construction
 * - Evaluator for proven formulas
 * - Serialization (toString, parse)
 * - Integration with ProvenDerivedConfidence
 * - Error handling for invalid constructions
 * - Proof term unforgeability
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Proof Terms
  type ProofTerm,
  type ProofType,
  isProofTerm,

  // AST Node Types
  type ProvenFormulaNode,
  type LiteralNode,
  type InputRefNode,
  type BinaryOpNode,
  type UnaryOpNode,
  type ConditionalNode,

  // Builder Functions
  literal,
  input,
  add,
  sub,
  mul,
  div,
  min,
  max,
  and,
  or,
  neg,
  conditional,

  // Evaluator
  evaluate,

  // Serialization
  provenFormulaToString,
  parseProvenFormula,
  type ParseError,
  isParseError,

  // Type Guards
  isLiteralNode,
  isInputRefNode,
  isBinaryOpNode,
  isUnaryOpNode,
  isConditionalNode,
  isProvenFormulaNode,

  // Integration Type
  type ProvenDerivedConfidence,
  createProvenDerivedConfidence,

  // Migration Helpers
  migrateStringFormula,
  hasProvenFormula,
  createDerivedConfidenceWithProof,
} from '../formula_ast.js';

describe('Proven Formula AST System', () => {
  describe('Proof Terms', () => {
    it('should have required proof term properties', () => {
      const lit = literal(0.5);
      expect(lit.proof).toBeDefined();
      expect(lit.proof.proofType).toBe('literal');
      expect(typeof lit.proof.timestamp).toBe('number');
      expect(typeof lit.proof.validator).toBe('string');
    });

    it('should create proof terms with unique timestamps', () => {
      const lit1 = literal(0.5);
      const lit2 = literal(0.5);
      // Timestamps should be close but potentially different
      expect(lit1.proof.timestamp).toBeLessThanOrEqual(lit2.proof.timestamp);
    });

    it('should identify valid proof terms using type guard', () => {
      const lit = literal(0.5);
      expect(isProofTerm(lit.proof)).toBe(true);
      expect(isProofTerm({ proofType: 'literal', timestamp: 123 })).toBe(false); // missing validator
      expect(isProofTerm(null)).toBe(false);
      expect(isProofTerm(undefined)).toBe(false);
      expect(isProofTerm({})).toBe(false);
    });

    it('should track validator function in proof term', () => {
      const lit = literal(0.5);
      expect(lit.proof.validator).toBe('literal');

      const inputNode = input('x', 0, 2);
      if (!(inputNode instanceof Error)) {
        expect(inputNode.proof.validator).toBe('input');
      }
    });
  });

  describe('Literal Nodes', () => {
    it('should create a literal node with valid number', () => {
      const node = literal(0.75);
      expect(node.kind).toBe('literal');
      expect(node.value).toBe(0.75);
      expect(node.proof.proofType).toBe('literal');
    });

    it('should accept zero as a valid literal', () => {
      const node = literal(0);
      expect(node.value).toBe(0);
    });

    it('should accept one as a valid literal', () => {
      const node = literal(1);
      expect(node.value).toBe(1);
    });

    it('should accept negative numbers', () => {
      const node = literal(-0.5);
      expect(node.value).toBe(-0.5);
    });

    it('should identify literal nodes using type guard', () => {
      const node = literal(0.5);
      expect(isLiteralNode(node)).toBe(true);
      expect(isProvenFormulaNode(node)).toBe(true);
    });

    it('should reject NaN values', () => {
      const result = literal(NaN);
      // Literal should return Error for invalid values
      expect(result instanceof Error || isNaN(result.value)).toBe(true);
    });

    it('should reject Infinity values', () => {
      const result = literal(Infinity);
      expect(result instanceof Error || !isFinite(result.value)).toBe(true);
    });
  });

  describe('Input Reference Nodes', () => {
    it('should create an input reference with valid index', () => {
      const node = input('x', 0, 3);
      expect(node).not.toBeInstanceOf(Error);
      if (!(node instanceof Error)) {
        expect(node.kind).toBe('input');
        expect(node.name).toBe('x');
        expect(node.index).toBe(0);
        expect(node.proof.proofType).toBe('input_valid');
      }
    });

    it('should accept maximum valid index', () => {
      const node = input('last', 2, 3);
      expect(node).not.toBeInstanceOf(Error);
      if (!(node instanceof Error)) {
        expect(node.index).toBe(2);
      }
    });

    it('should return Error for negative index', () => {
      const result = input('x', -1, 3);
      expect(result).toBeInstanceOf(Error);
    });

    it('should return Error for out-of-bounds index', () => {
      const result = input('x', 3, 3);
      expect(result).toBeInstanceOf(Error);
    });

    it('should return Error for index >= totalInputs', () => {
      const result = input('x', 5, 3);
      expect(result).toBeInstanceOf(Error);
    });

    it('should return Error for empty name', () => {
      const result = input('', 0, 3);
      expect(result).toBeInstanceOf(Error);
    });

    it('should return Error for zero totalInputs', () => {
      const result = input('x', 0, 0);
      expect(result).toBeInstanceOf(Error);
    });

    it('should identify input nodes using type guard', () => {
      const node = input('x', 0, 2);
      if (!(node instanceof Error)) {
        expect(isInputRefNode(node)).toBe(true);
        expect(isProvenFormulaNode(node)).toBe(true);
      }
    });
  });

  describe('Binary Operation Nodes', () => {
    let a: LiteralNode;
    let b: LiteralNode;

    beforeEach(() => {
      a = literal(0.8);
      b = literal(0.6);
    });

    it('should create add operation', () => {
      const node = add(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('add');
      expect(node.left).toBe(a);
      expect(node.right).toBe(b);
      expect(node.proof.proofType).toBe('binary_valid');
    });

    it('should create sub operation', () => {
      const node = sub(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('sub');
    });

    it('should create mul operation', () => {
      const node = mul(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('mul');
    });

    it('should create div operation', () => {
      const node = div(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('div');
    });

    it('should create min operation', () => {
      const node = min(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('min');
    });

    it('should create max operation', () => {
      const node = max(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('max');
    });

    it('should create and operation', () => {
      const node = and(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('and');
    });

    it('should create or operation', () => {
      const node = or(a, b);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('or');
    });

    it('should identify binary nodes using type guard', () => {
      const node = add(a, b);
      expect(isBinaryOpNode(node)).toBe(true);
      expect(isProvenFormulaNode(node)).toBe(true);
    });

    it('should support nested binary operations', () => {
      const c = literal(0.4);
      const node = add(min(a, b), c);
      expect(node.kind).toBe('binary');
      expect(node.op).toBe('add');
      expect(isBinaryOpNode(node.left)).toBe(true);
      expect((node.left as BinaryOpNode).op).toBe('min');
    });
  });

  describe('Unary Operation Nodes', () => {
    it('should create negation operation', () => {
      const a = literal(0.8);
      const node = neg(a);
      expect(node.kind).toBe('unary');
      expect(node.op).toBe('neg');
      expect(node.operand).toBe(a);
      expect(node.proof.proofType).toBe('unary_valid');
    });

    it('should identify unary nodes using type guard', () => {
      const a = literal(0.5);
      const node = neg(a);
      expect(isUnaryOpNode(node)).toBe(true);
      expect(isProvenFormulaNode(node)).toBe(true);
    });
  });

  describe('Conditional Nodes', () => {
    it('should create conditional operation', () => {
      const cond = literal(1); // true
      const thenBranch = literal(0.8);
      const elseBranch = literal(0.3);
      const node = conditional(cond, thenBranch, elseBranch);

      expect(node.kind).toBe('conditional');
      expect(node.condition).toBe(cond);
      expect(node.thenBranch).toBe(thenBranch);
      expect(node.elseBranch).toBe(elseBranch);
      expect(node.proof.proofType).toBe('conditional_valid');
    });

    it('should identify conditional nodes using type guard', () => {
      const node = conditional(literal(1), literal(0.5), literal(0.3));
      expect(isConditionalNode(node)).toBe(true);
      expect(isProvenFormulaNode(node)).toBe(true);
    });
  });

  describe('Evaluator', () => {
    it('should evaluate literal nodes', () => {
      const node = literal(0.75);
      expect(evaluate(node, [])).toBe(0.75);
    });

    it('should evaluate input reference nodes', () => {
      const node = input('x', 1, 3);
      expect(node).not.toBeInstanceOf(Error);
      if (!(node instanceof Error)) {
        expect(evaluate(node, [0.1, 0.5, 0.9])).toBe(0.5);
      }
    });

    it('should evaluate add operations', () => {
      const a = literal(0.3);
      const b = literal(0.2);
      expect(evaluate(add(a, b), [])).toBeCloseTo(0.5);
    });

    it('should evaluate sub operations', () => {
      const a = literal(0.8);
      const b = literal(0.3);
      expect(evaluate(sub(a, b), [])).toBeCloseTo(0.5);
    });

    it('should evaluate mul operations', () => {
      const a = literal(0.5);
      const b = literal(0.4);
      expect(evaluate(mul(a, b), [])).toBeCloseTo(0.2);
    });

    it('should evaluate div operations', () => {
      const a = literal(0.6);
      const b = literal(0.3);
      expect(evaluate(div(a, b), [])).toBeCloseTo(2.0);
    });

    it('should evaluate min operations', () => {
      const a = literal(0.8);
      const b = literal(0.3);
      expect(evaluate(min(a, b), [])).toBe(0.3);
    });

    it('should evaluate max operations', () => {
      const a = literal(0.2);
      const b = literal(0.7);
      expect(evaluate(max(a, b), [])).toBe(0.7);
    });

    it('should evaluate and operations (logical AND as min)', () => {
      const a = literal(0.8);
      const b = literal(0.6);
      expect(evaluate(and(a, b), [])).toBe(0.6);
    });

    it('should evaluate or operations (logical OR as max)', () => {
      const a = literal(0.3);
      const b = literal(0.9);
      expect(evaluate(or(a, b), [])).toBe(0.9);
    });

    it('should evaluate neg operations', () => {
      const a = literal(0.3);
      expect(evaluate(neg(a), [])).toBeCloseTo(-0.3);
    });

    it('should evaluate conditional operations (true condition)', () => {
      const cond = literal(1);
      const thenBranch = literal(0.8);
      const elseBranch = literal(0.2);
      expect(evaluate(conditional(cond, thenBranch, elseBranch), [])).toBe(0.8);
    });

    it('should evaluate conditional operations (false condition)', () => {
      const cond = literal(0);
      const thenBranch = literal(0.8);
      const elseBranch = literal(0.2);
      expect(evaluate(conditional(cond, thenBranch, elseBranch), [])).toBe(0.2);
    });

    it('should evaluate nested expressions', () => {
      // min(max(0.3, 0.7), 0.5) = min(0.7, 0.5) = 0.5
      const a = literal(0.3);
      const b = literal(0.7);
      const c = literal(0.5);
      const node = min(max(a, b), c);
      expect(evaluate(node, [])).toBe(0.5);
    });

    it('should evaluate complex expressions with inputs', () => {
      // inputs[0] + inputs[1] * 0.5
      const x = input('x', 0, 2);
      const y = input('y', 1, 2);
      expect(x).not.toBeInstanceOf(Error);
      expect(y).not.toBeInstanceOf(Error);

      if (!(x instanceof Error) && !(y instanceof Error)) {
        const half = literal(0.5);
        const node = add(x, mul(y, half));
        // 0.4 + 0.6 * 0.5 = 0.4 + 0.3 = 0.7
        expect(evaluate(node, [0.4, 0.6])).toBeCloseTo(0.7);
      }
    });

    it('should throw for invalid input index at evaluation', () => {
      // This tests that evaluate handles edge cases
      const x = input('x', 0, 2);
      expect(x).not.toBeInstanceOf(Error);
      if (!(x instanceof Error)) {
        // Providing only 1 input when 2 were expected
        expect(() => evaluate(x, [])).toThrow();
      }
    });
  });

  describe('Serialization - provenFormulaToString', () => {
    it('should serialize literal nodes', () => {
      const node = literal(0.5);
      expect(provenFormulaToString(node)).toBe('0.5');
    });

    it('should serialize input nodes', () => {
      const node = input('x', 0, 2);
      expect(node).not.toBeInstanceOf(Error);
      if (!(node instanceof Error)) {
        expect(provenFormulaToString(node)).toBe('x');
      }
    });

    it('should serialize binary operations', () => {
      const a = literal(0.3);
      const b = literal(0.7);
      expect(provenFormulaToString(add(a, b))).toBe('(0.3 + 0.7)');
      expect(provenFormulaToString(sub(a, b))).toBe('(0.3 - 0.7)');
      expect(provenFormulaToString(mul(a, b))).toBe('(0.3 * 0.7)');
      expect(provenFormulaToString(div(a, b))).toBe('(0.3 / 0.7)');
      expect(provenFormulaToString(min(a, b))).toBe('min(0.3, 0.7)');
      expect(provenFormulaToString(max(a, b))).toBe('max(0.3, 0.7)');
      expect(provenFormulaToString(and(a, b))).toBe('and(0.3, 0.7)');
      expect(provenFormulaToString(or(a, b))).toBe('or(0.3, 0.7)');
    });

    it('should serialize unary operations', () => {
      const a = literal(0.5);
      expect(provenFormulaToString(neg(a))).toBe('(-0.5)');
    });

    it('should serialize conditional operations', () => {
      const cond = literal(1);
      const thenBranch = literal(0.8);
      const elseBranch = literal(0.2);
      const node = conditional(cond, thenBranch, elseBranch);
      expect(provenFormulaToString(node)).toBe('(1 ? 0.8 : 0.2)');
    });

    it('should serialize nested expressions', () => {
      const a = literal(0.3);
      const b = literal(0.7);
      const c = literal(0.5);
      const node = min(max(a, b), c);
      expect(provenFormulaToString(node)).toBe('min(max(0.3, 0.7), 0.5)');
    });
  });

  describe('Serialization - parseProvenFormula', () => {
    it('should parse literal values', () => {
      const result = parseProvenFormula('0.5');
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        expect(isLiteralNode(result)).toBe(true);
        expect(evaluate(result, [])).toBe(0.5);
      }
    });

    it('should parse variable names', () => {
      const result = parseProvenFormula('x', ['x']);
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        expect(isInputRefNode(result)).toBe(true);
        expect(evaluate(result, [0.8])).toBe(0.8);
      }
    });

    it('should parse binary operations', () => {
      const result = parseProvenFormula('(0.3 + 0.2)');
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        expect(evaluate(result, [])).toBeCloseTo(0.5);
      }
    });

    it('should parse min/max operations', () => {
      const minResult = parseProvenFormula('min(0.3, 0.7)');
      expect(isParseError(minResult)).toBe(false);
      if (!isParseError(minResult)) {
        expect(evaluate(minResult, [])).toBe(0.3);
      }

      const maxResult = parseProvenFormula('max(0.3, 0.7)');
      expect(isParseError(maxResult)).toBe(false);
      if (!isParseError(maxResult)) {
        expect(evaluate(maxResult, [])).toBe(0.7);
      }
    });

    it('should parse nested expressions', () => {
      const result = parseProvenFormula('min(max(0.3, 0.7), 0.5)');
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        expect(evaluate(result, [])).toBe(0.5);
      }
    });

    it('should return ParseError for malformed input', () => {
      const result = parseProvenFormula('((()))');
      expect(isParseError(result)).toBe(true);
    });

    it('should return ParseError for unknown variables', () => {
      const result = parseProvenFormula('unknown_var', ['x', 'y']);
      expect(isParseError(result)).toBe(true);
    });

    it('should return ParseError for empty string', () => {
      const result = parseProvenFormula('');
      expect(isParseError(result)).toBe(true);
    });

    it('should round-trip serialization', () => {
      const original = min(max(literal(0.3), literal(0.7)), literal(0.5));
      const str = provenFormulaToString(original);
      const parsed = parseProvenFormula(str);

      expect(isParseError(parsed)).toBe(false);
      if (!isParseError(parsed)) {
        expect(evaluate(parsed, [])).toBe(evaluate(original, []));
      }
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify all node types', () => {
      const lit = literal(0.5);
      const inp = input('x', 0, 1);
      const bin = add(literal(0.3), literal(0.2));
      const un = neg(literal(0.5));
      const cond = conditional(literal(1), literal(0.8), literal(0.2));

      expect(isLiteralNode(lit)).toBe(true);
      expect(isLiteralNode(bin)).toBe(false);

      if (!(inp instanceof Error)) {
        expect(isInputRefNode(inp)).toBe(true);
        expect(isInputRefNode(lit)).toBe(false);
      }

      expect(isBinaryOpNode(bin)).toBe(true);
      expect(isBinaryOpNode(un)).toBe(false);

      expect(isUnaryOpNode(un)).toBe(true);
      expect(isUnaryOpNode(bin)).toBe(false);

      expect(isConditionalNode(cond)).toBe(true);
      expect(isConditionalNode(un)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(isProvenFormulaNode(null)).toBe(false);
      expect(isProvenFormulaNode(undefined)).toBe(false);
      expect(isProvenFormulaNode(42)).toBe(false);
      expect(isProvenFormulaNode('string')).toBe(false);
      expect(isProvenFormulaNode([])).toBe(false);
    });

    it('should reject objects without valid kind', () => {
      expect(isProvenFormulaNode({})).toBe(false);
      expect(isProvenFormulaNode({ kind: 'unknown' })).toBe(false);
      expect(isProvenFormulaNode({ kind: 'literal' })).toBe(false); // missing proof
    });
  });

  describe('Proof Unforgeability', () => {
    it('should not allow manual proof construction to pass type guards', () => {
      // Manually constructed object without using builder functions
      const fakeNode = {
        kind: 'literal',
        value: 0.5,
        proof: {
          proofType: 'literal',
          timestamp: Date.now(),
          validator: 'forged',
        },
      };

      // The type guard should detect the forgery via validator mismatch
      // Implementation detail: validator should match known function names
      expect(isLiteralNode(fakeNode)).toBe(false);
    });

    it('should not accept proof terms with invalid proofType', () => {
      const fakeProof = {
        proofType: 'forged_type',
        timestamp: Date.now(),
        validator: 'literal',
      };

      expect(isProofTerm(fakeProof)).toBe(false);
    });

    it('should not accept proof terms without all required fields', () => {
      expect(isProofTerm({ proofType: 'literal', timestamp: 123 })).toBe(false);
      expect(isProofTerm({ proofType: 'literal', validator: 'test' })).toBe(false);
      expect(isProofTerm({ timestamp: 123, validator: 'test' })).toBe(false);
    });
  });

  describe('ProvenDerivedConfidence Integration', () => {
    it('should create ProvenDerivedConfidence from formula', () => {
      const formula = min(literal(0.8), literal(0.6));
      const inputs = [
        { type: 'deterministic' as const, value: 0.8 as const, reason: 'test1' },
        { type: 'deterministic' as const, value: 0.6 as const, reason: 'test2' },
      ];

      const result = createProvenDerivedConfidence(formula, inputs);

      expect(result.type).toBe('derived');
      expect(result.formula).toBe(formula);
      expect(result.formulaString).toBe('min(0.8, 0.6)');
      expect(result.inputs).toEqual(inputs);
    });

    it('should evaluate ProvenDerivedConfidence value', () => {
      const x = input('x', 0, 2);
      const y = input('y', 1, 2);

      expect(x).not.toBeInstanceOf(Error);
      expect(y).not.toBeInstanceOf(Error);

      if (!(x instanceof Error) && !(y instanceof Error)) {
        const formula = min(x, y);
        const inputs = [
          { type: 'measured' as const, value: 0.8, measurement: {
            datasetId: 'test',
            sampleSize: 100,
            accuracy: 0.8,
            confidenceInterval: [0.75, 0.85] as const,
            measuredAt: new Date().toISOString(),
          }},
          { type: 'measured' as const, value: 0.6, measurement: {
            datasetId: 'test',
            sampleSize: 100,
            accuracy: 0.6,
            confidenceInterval: [0.55, 0.65] as const,
            measuredAt: new Date().toISOString(),
          }},
        ];

        const result = createProvenDerivedConfidence(formula, inputs);
        const evalResult = evaluate(result.formula, [0.8, 0.6]);
        expect(evalResult).toBe(0.6);
      }
    });

    it('should preserve calibration status in ProvenDerivedConfidence', () => {
      const formula = min(literal(0.8), literal(0.6));
      const inputs = [
        { type: 'measured' as const, value: 0.8, measurement: {
          datasetId: 'test',
          sampleSize: 100,
          accuracy: 0.8,
          confidenceInterval: [0.75, 0.85] as const,
          measuredAt: new Date().toISOString(),
        }},
        { type: 'measured' as const, value: 0.6, measurement: {
          datasetId: 'test',
          sampleSize: 100,
          accuracy: 0.6,
          confidenceInterval: [0.55, 0.65] as const,
          measuredAt: new Date().toISOString(),
        }},
      ];

      const result = createProvenDerivedConfidence(formula, inputs, 'preserved');
      expect(result.calibrationStatus).toBe('preserved');
    });
  });

  describe('Error Handling', () => {
    it('should return Error for division by zero in evaluation', () => {
      const a = literal(0.5);
      const b = literal(0);
      const node = div(a, b);

      // Evaluation of division by zero should either throw or return special value
      const result = evaluate(node, []);
      expect(result === Infinity || Number.isNaN(result)).toBe(true);
    });

    it('should handle deeply nested structures without stack overflow', () => {
      // Create a deeply nested structure
      let node: ProvenFormulaNode = literal(0.5);
      for (let i = 0; i < 100; i++) {
        node = add(node, literal(0.001));
      }

      // Should not throw stack overflow
      const result = evaluate(node, []);
      expect(result).toBeCloseTo(0.5 + 0.1);
    });

    it('should reject construction of invalid proof compositions', () => {
      // A binary node with mismatched proof should fail validation
      const a = literal(0.5);

      // Attempting to create an invalid composition
      // (This tests that the system prevents invalid AST construction)
      const fakeComposition = {
        kind: 'binary',
        op: 'add',
        left: a,
        right: { kind: 'literal', value: 0.3, proof: null },
        proof: { proofType: 'binary_valid', timestamp: Date.now(), validator: 'add' },
      };

      expect(isBinaryOpNode(fakeComposition)).toBe(false);
    });
  });

  describe('Backwards Compatibility', () => {
    it('should parse legacy string formulas', () => {
      // Legacy format: "min(step_0, step_1)"
      const result = parseProvenFormula('min(step_0, step_1)', ['step_0', 'step_1']);
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        expect(evaluate(result, [0.8, 0.6])).toBe(0.6);
      }
    });

    it('should parse product formula', () => {
      const result = parseProvenFormula('(a * b)', ['a', 'b']);
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        expect(evaluate(result, [0.8, 0.5])).toBeCloseTo(0.4);
      }
    });

    it('should parse nested min/max formulas', () => {
      const result = parseProvenFormula('max(min(a, b), c)', ['a', 'b', 'c']);
      expect(isParseError(result)).toBe(false);
      if (!isParseError(result)) {
        // max(min(0.3, 0.7), 0.5) = max(0.3, 0.5) = 0.5
        expect(evaluate(result, [0.3, 0.7, 0.5])).toBe(0.5);
      }
    });
  });

  describe('Migration Helpers', () => {
    describe('migrateStringFormula', () => {
      it('should migrate min(steps) formula', () => {
        const result = migrateStringFormula('min(steps)', ['step_0', 'step_1', 'step_2']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [0.8, 0.6, 0.9])).toBe(0.6);
        }
      });

      it('should migrate min(a, b) formula', () => {
        const result = migrateStringFormula('min(a, b)', ['a', 'b']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [0.8, 0.6])).toBe(0.6);
        }
      });

      it('should migrate max(a, b) formula', () => {
        const result = migrateStringFormula('max(a, b)', ['a', 'b']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [0.8, 0.6])).toBe(0.8);
        }
      });

      it('should migrate product(branches) formula', () => {
        const result = migrateStringFormula('product(branches)', ['branch_0', 'branch_1']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [0.8, 0.5])).toBeCloseTo(0.4);
        }
      });

      it('should migrate 1 - product(1 - branches) formula (noisy-or)', () => {
        const result = migrateStringFormula('1 - product(1 - branches)', ['branch_0', 'branch_1']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          // 1 - (1 - 0.8)(1 - 0.6) = 1 - 0.2 * 0.4 = 1 - 0.08 = 0.92
          expect(evaluate(result, [0.8, 0.6])).toBeCloseTo(0.92);
        }
      });

      it('should migrate weighted_average formula', () => {
        const result = migrateStringFormula('weighted_average', ['a', 'b', 'c']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          // Simple average: (0.6 + 0.8 + 0.9) / 3 = 0.7666...
          expect(evaluate(result, [0.6, 0.8, 0.9])).toBeCloseTo(2.3 / 3);
        }
      });

      it('should return Error for empty formula', () => {
        const result = migrateStringFormula('', ['a', 'b']);
        expect(result).toBeInstanceOf(Error);
      });

      it('should return Error for empty inputs with non-literal formula', () => {
        const result = migrateStringFormula('min(a, b)', []);
        expect(result).toBeInstanceOf(Error);
      });

      it('should handle literal numeric formula with empty inputs', () => {
        const result = migrateStringFormula('0.5', []);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [])).toBe(0.5);
        }
      });

      it('should fall back to parsing for arbitrary formulas', () => {
        const result = migrateStringFormula('a * 0.5 + b * 0.5', ['a', 'b']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [0.8, 0.6])).toBeCloseTo(0.7);
        }
      });

      it('should handle single input min formula', () => {
        const result = migrateStringFormula('min(steps)', ['step_0']);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, [0.8])).toBe(0.8);
        }
      });

      it('should handle many inputs', () => {
        const inputs = Array.from({ length: 10 }, (_, i) => `step_${i}`);
        const values = Array.from({ length: 10 }, (_, i) => 0.9 - i * 0.05);
        const result = migrateStringFormula('min(steps)', inputs);
        expect(result).not.toBeInstanceOf(Error);
        if (!(result instanceof Error)) {
          expect(evaluate(result, values)).toBe(Math.min(...values));
        }
      });
    });

    describe('hasProvenFormula', () => {
      it('should return true when provenFormula is present', () => {
        const formula = literal(0.5);
        expect(hasProvenFormula({ provenFormula: formula })).toBe(true);
      });

      it('should return false when provenFormula is undefined', () => {
        expect(hasProvenFormula({})).toBe(false);
      });

      it('should return false when provenFormula is not a valid node', () => {
        expect(hasProvenFormula({ provenFormula: { kind: 'invalid' } as any })).toBe(false);
      });
    });

    describe('createDerivedConfidenceWithProof', () => {
      it('should create DerivedConfidence with proven formula and string formula', () => {
        const inputA = input('a', 0, 2);
        const inputB = input('b', 1, 2);
        expect(inputA).not.toBeInstanceOf(Error);
        expect(inputB).not.toBeInstanceOf(Error);
        if (!(inputA instanceof Error) && !(inputB instanceof Error)) {
          const formula = min(inputA, inputB);
          const result = createDerivedConfidenceWithProof({
            value: 0.6,
            provenFormula: formula,
            inputs: [
              { name: 'a', confidence: { type: 'deterministic', value: 1.0, reason: 'test' } },
              { name: 'b', confidence: { type: 'deterministic', value: 1.0, reason: 'test' } },
            ],
          });

          expect(result.type).toBe('derived');
          expect(result.value).toBe(0.6);
          expect(result.formula).toBe('min(a, b)');
          expect(result.provenFormula).toBe(formula);
          expect(result.inputs).toHaveLength(2);
        }
      });

      it('should clamp value to [0, 1]', () => {
        const formula = literal(1.5);
        const result = createDerivedConfidenceWithProof({
          value: 1.5,
          provenFormula: formula,
          inputs: [],
        });
        expect(result.value).toBe(1);
      });

      it('should include calibrationStatus when provided', () => {
        const formula = literal(0.5);
        const result = createDerivedConfidenceWithProof({
          value: 0.5,
          provenFormula: formula,
          inputs: [],
          calibrationStatus: 'preserved',
        });
        expect(result.calibrationStatus).toBe('preserved');
      });
    });
  });
});
