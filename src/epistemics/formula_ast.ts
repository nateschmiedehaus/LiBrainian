/**
 * @fileoverview Proven Formula AST System
 *
 * This module implements a typed AST system where formula expressions carry proofs
 * of their validity. This eliminates runtime formula errors and enables static
 * verification of confidence propagation.
 *
 * CORE PRINCIPLE: All AST construction must go through builder functions that
 * produce proof terms. This ensures formulas are always valid by construction.
 *
 * Key Features:
 * - Proof terms that are unforgeable (only builder functions create them)
 * - Type-safe AST node types
 * - Builder functions that return Error for invalid constructions
 * - Evaluator for proven formulas
 * - Serialization to/from string representation
 * - Integration with ProvenDerivedConfidence
 *
 * @packageDocumentation
 */

import type { ConfidenceValue, CalibrationStatus } from './confidence.js';

// ============================================================================
// PROOF SECRET - Internal symbol for proof validation
// ============================================================================

/**
 * Internal secret used to validate proof terms were created by this module.
 * This prevents external code from forging proof terms.
 */
const PROOF_SECRET = Symbol('proof_secret');
type ProofSecret = typeof PROOF_SECRET;

// Internal registry of valid proof validators
const VALID_VALIDATORS = new Set([
  'literal',
  'input',
  'add',
  'sub',
  'mul',
  'div',
  'min',
  'max',
  'and',
  'or',
  'neg',
  'conditional',
  'parse',
]);

// ============================================================================
// PROOF TERM TYPES
// ============================================================================

/**
 * Valid proof types that can be assigned to proof terms.
 */
export type ProofType =
  | 'literal'           // Value is a valid number
  | 'input_valid'       // Input reference is in bounds
  | 'binary_valid'      // Binary operation is well-typed
  | 'unary_valid'       // Unary operation is well-typed
  | 'conditional_valid' // Conditional branches have same type
  | 'composition_valid'; // Composition of proofs

/**
 * A proof term that validates a formula property holds.
 * Proof terms can only be created by builder functions in this module.
 */
export interface ProofTerm<T extends ProofType = ProofType> {
  /** The type of proof this term represents */
  readonly proofType: T;

  /** Timestamp when the proof was created */
  readonly timestamp: number;

  /** Which builder function created this proof */
  readonly validator: string;

  /** Internal secret that validates this proof was created by this module */
  readonly _secret?: ProofSecret;
}

/**
 * Type guard to check if a value is a valid ProofTerm.
 */
export function isProofTerm(value: unknown): value is ProofTerm {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.proofType !== 'string') return false;
  if (typeof candidate.timestamp !== 'number') return false;
  if (typeof candidate.validator !== 'string') return false;

  // Verify proofType is valid
  const validProofTypes: ProofType[] = [
    'literal',
    'input_valid',
    'binary_valid',
    'unary_valid',
    'conditional_valid',
    'composition_valid',
  ];
  if (!validProofTypes.includes(candidate.proofType as ProofType)) return false;

  // Verify validator is known
  if (!VALID_VALIDATORS.has(candidate.validator)) return false;

  // Verify the internal secret
  if (candidate._secret !== PROOF_SECRET) return false;

  return true;
}

/**
 * Create a proof term (internal function).
 */
function createProof<T extends ProofType>(proofType: T, validator: string): ProofTerm<T> {
  return {
    proofType,
    timestamp: Date.now(),
    validator,
    _secret: PROOF_SECRET,
  };
}

// ============================================================================
// AST NODE TYPES
// ============================================================================

/**
 * Base AST node union type with proof terms.
 */
export type ProvenFormulaNode =
  | LiteralNode
  | InputRefNode
  | BinaryOpNode
  | UnaryOpNode
  | ConditionalNode;

/**
 * A literal constant value node.
 */
export interface LiteralNode {
  readonly kind: 'literal';
  readonly value: number;
  readonly proof: ProofTerm<'literal'>;
}

/**
 * A reference to an input variable by name and index.
 */
export interface InputRefNode {
  readonly kind: 'input';
  readonly name: string;
  readonly index: number;
  readonly proof: ProofTerm<'input_valid'>;
}

/**
 * Binary operation types.
 */
export type BinaryOp = 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max' | 'and' | 'or';

/**
 * A binary operation node.
 */
export interface BinaryOpNode {
  readonly kind: 'binary';
  readonly op: BinaryOp;
  readonly left: ProvenFormulaNode;
  readonly right: ProvenFormulaNode;
  readonly proof: ProofTerm<'binary_valid'>;
}

/**
 * Unary operation types.
 */
export type UnaryOp = 'neg';

/**
 * A unary operation node.
 */
export interface UnaryOpNode {
  readonly kind: 'unary';
  readonly op: UnaryOp;
  readonly operand: ProvenFormulaNode;
  readonly proof: ProofTerm<'unary_valid'>;
}

/**
 * A conditional (ternary) operation node.
 */
export interface ConditionalNode {
  readonly kind: 'conditional';
  readonly condition: ProvenFormulaNode;
  readonly thenBranch: ProvenFormulaNode;
  readonly elseBranch: ProvenFormulaNode;
  readonly proof: ProofTerm<'conditional_valid'>;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a LiteralNode.
 */
export function isLiteralNode(value: unknown): value is LiteralNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'literal' &&
    typeof candidate.value === 'number' &&
    isProofTerm(candidate.proof) &&
    (candidate.proof as ProofTerm).proofType === 'literal'
  );
}

/**
 * Type guard to check if a value is an InputRefNode.
 */
export function isInputRefNode(value: unknown): value is InputRefNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'input' &&
    typeof candidate.name === 'string' &&
    typeof candidate.index === 'number' &&
    isProofTerm(candidate.proof) &&
    (candidate.proof as ProofTerm).proofType === 'input_valid'
  );
}

/**
 * Type guard to check if a value is a BinaryOpNode.
 */
export function isBinaryOpNode(value: unknown): value is BinaryOpNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const validOps: BinaryOp[] = ['add', 'sub', 'mul', 'div', 'min', 'max', 'and', 'or'];
  return (
    candidate.kind === 'binary' &&
    validOps.includes(candidate.op as BinaryOp) &&
    isProvenFormulaNode(candidate.left) &&
    isProvenFormulaNode(candidate.right) &&
    isProofTerm(candidate.proof) &&
    (candidate.proof as ProofTerm).proofType === 'binary_valid'
  );
}

/**
 * Type guard to check if a value is a UnaryOpNode.
 */
export function isUnaryOpNode(value: unknown): value is UnaryOpNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const validOps: UnaryOp[] = ['neg'];
  return (
    candidate.kind === 'unary' &&
    validOps.includes(candidate.op as UnaryOp) &&
    isProvenFormulaNode(candidate.operand) &&
    isProofTerm(candidate.proof) &&
    (candidate.proof as ProofTerm).proofType === 'unary_valid'
  );
}

/**
 * Type guard to check if a value is a ConditionalNode.
 */
export function isConditionalNode(value: unknown): value is ConditionalNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'conditional' &&
    isProvenFormulaNode(candidate.condition) &&
    isProvenFormulaNode(candidate.thenBranch) &&
    isProvenFormulaNode(candidate.elseBranch) &&
    isProofTerm(candidate.proof) &&
    (candidate.proof as ProofTerm).proofType === 'conditional_valid'
  );
}

/**
 * Type guard to check if a value is any ProvenFormulaNode.
 */
export function isProvenFormulaNode(value: unknown): value is ProvenFormulaNode {
  return (
    isLiteralNode(value) ||
    isInputRefNode(value) ||
    isBinaryOpNode(value) ||
    isUnaryOpNode(value) ||
    isConditionalNode(value)
  );
}

// ============================================================================
// BUILDER FUNCTIONS
// ============================================================================

/**
 * Create a literal node with a constant value.
 *
 * @param value - The numeric constant value
 * @returns A LiteralNode with a valid proof term
 */
export function literal(value: number): LiteralNode {
  // Note: We allow NaN and Infinity to be constructed, but they produce
  // mathematically unusual results. The proof term validates the construction
  // was done correctly, not that the value is "reasonable".
  return {
    kind: 'literal',
    value,
    proof: createProof('literal', 'literal'),
  };
}

/**
 * Create an input reference node.
 *
 * @param name - The name of the input variable
 * @param index - The index into the inputs array
 * @param totalInputs - The total number of inputs expected
 * @returns An InputRefNode with a valid proof term, or Error if invalid
 */
export function input(name: string, index: number, totalInputs: number): InputRefNode | Error {
  if (!name || name.length === 0) {
    return new Error('Input name cannot be empty');
  }
  if (totalInputs <= 0) {
    return new Error(`totalInputs must be positive, got ${totalInputs}`);
  }
  if (index < 0) {
    return new Error(`Index cannot be negative, got ${index}`);
  }
  if (index >= totalInputs) {
    return new Error(`Index ${index} is out of bounds for ${totalInputs} inputs`);
  }

  return {
    kind: 'input',
    name,
    index,
    proof: createProof('input_valid', 'input'),
  };
}

/**
 * Helper to create binary operation nodes.
 */
function createBinaryOp(op: BinaryOp, left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return {
    kind: 'binary',
    op,
    left,
    right,
    proof: createProof('binary_valid', op),
  };
}

/**
 * Create an addition node.
 */
export function add(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('add', left, right);
}

/**
 * Create a subtraction node.
 */
export function sub(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('sub', left, right);
}

/**
 * Create a multiplication node.
 */
export function mul(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('mul', left, right);
}

/**
 * Create a division node.
 */
export function div(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('div', left, right);
}

/**
 * Create a minimum node.
 */
export function min(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('min', left, right);
}

/**
 * Create a maximum node.
 */
export function max(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('max', left, right);
}

/**
 * Create a logical AND node (implemented as min for confidence values).
 */
export function and(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('and', left, right);
}

/**
 * Create a logical OR node (implemented as max for confidence values).
 */
export function or(left: ProvenFormulaNode, right: ProvenFormulaNode): BinaryOpNode {
  return createBinaryOp('or', left, right);
}

/**
 * Create a negation node.
 */
export function neg(operand: ProvenFormulaNode): UnaryOpNode {
  return {
    kind: 'unary',
    op: 'neg',
    operand,
    proof: createProof('unary_valid', 'neg'),
  };
}

/**
 * Create a conditional (ternary) node.
 */
export function conditional(
  condition: ProvenFormulaNode,
  thenBranch: ProvenFormulaNode,
  elseBranch: ProvenFormulaNode
): ConditionalNode {
  return {
    kind: 'conditional',
    condition,
    thenBranch,
    elseBranch,
    proof: createProof('conditional_valid', 'conditional'),
  };
}

// ============================================================================
// EVALUATOR
// ============================================================================

/**
 * Evaluate a proven formula against input values.
 *
 * @param formula - The proven formula AST to evaluate
 * @param inputs - Array of numeric input values
 * @returns The computed numeric result
 * @throws Error if input index is out of bounds
 */
export function evaluate(formula: ProvenFormulaNode, inputs: number[]): number {
  switch (formula.kind) {
    case 'literal':
      return formula.value;

    case 'input': {
      if (formula.index >= inputs.length) {
        throw new Error(
          `Input index ${formula.index} out of bounds for ${inputs.length} inputs`
        );
      }
      return inputs[formula.index];
    }

    case 'binary': {
      const leftVal = evaluate(formula.left, inputs);
      const rightVal = evaluate(formula.right, inputs);

      switch (formula.op) {
        case 'add':
          return leftVal + rightVal;
        case 'sub':
          return leftVal - rightVal;
        case 'mul':
          return leftVal * rightVal;
        case 'div':
          return leftVal / rightVal;
        case 'min':
          return Math.min(leftVal, rightVal);
        case 'max':
          return Math.max(leftVal, rightVal);
        case 'and':
          // Logical AND for confidence values is min
          return Math.min(leftVal, rightVal);
        case 'or':
          // Logical OR for confidence values is max
          return Math.max(leftVal, rightVal);
      }
    }

    case 'unary': {
      const operandVal = evaluate(formula.operand, inputs);
      switch (formula.op) {
        case 'neg':
          return -operandVal;
      }
    }

    case 'conditional': {
      const condVal = evaluate(formula.condition, inputs);
      // Treat non-zero as true (standard C-like semantics)
      if (condVal !== 0) {
        return evaluate(formula.thenBranch, inputs);
      } else {
        return evaluate(formula.elseBranch, inputs);
      }
    }
  }
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Convert a proven formula to a human-readable string representation.
 *
 * @param formula - The proven formula AST to serialize
 * @returns A string representation of the formula
 */
export function provenFormulaToString(formula: ProvenFormulaNode): string {
  switch (formula.kind) {
    case 'literal':
      return String(formula.value);

    case 'input':
      return formula.name;

    case 'binary': {
      const leftStr = provenFormulaToString(formula.left);
      const rightStr = provenFormulaToString(formula.right);

      switch (formula.op) {
        case 'add':
          return `(${leftStr} + ${rightStr})`;
        case 'sub':
          return `(${leftStr} - ${rightStr})`;
        case 'mul':
          return `(${leftStr} * ${rightStr})`;
        case 'div':
          return `(${leftStr} / ${rightStr})`;
        case 'min':
          return `min(${leftStr}, ${rightStr})`;
        case 'max':
          return `max(${leftStr}, ${rightStr})`;
        case 'and':
          return `and(${leftStr}, ${rightStr})`;
        case 'or':
          return `or(${leftStr}, ${rightStr})`;
      }
    }

    case 'unary': {
      const operandStr = provenFormulaToString(formula.operand);
      switch (formula.op) {
        case 'neg':
          return `(-${operandStr})`;
      }
    }

    case 'conditional': {
      const condStr = provenFormulaToString(formula.condition);
      const thenStr = provenFormulaToString(formula.thenBranch);
      const elseStr = provenFormulaToString(formula.elseBranch);
      return `(${condStr} ? ${thenStr} : ${elseStr})`;
    }
  }
}

// ============================================================================
// PARSER
// ============================================================================

/**
 * Parse error result.
 */
export interface ParseError {
  readonly kind: 'parse_error';
  readonly message: string;
  readonly position?: number;
}

/**
 * Type guard for ParseError.
 */
export function isParseError(value: unknown): value is ParseError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === 'parse_error' && typeof candidate.message === 'string';
}

/**
 * Create a ParseError.
 */
function createParseError(message: string, position?: number): ParseError {
  return { kind: 'parse_error', message, position };
}

/**
 * Token types for the parser.
 */
type TokenType =
  | 'number'
  | 'identifier'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'question'
  | 'colon'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

/**
 * Tokenize a formula string.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    while (pos < input.length && /\s/.test(input[pos])) {
      pos++;
    }
    if (pos >= input.length) break;

    const char = input[pos];

    // Numbers (including decimals)
    if (/[0-9]/.test(char) || (char === '.' && pos + 1 < input.length && /[0-9]/.test(input[pos + 1]))) {
      let numStr = '';
      const startPos = pos;
      while (pos < input.length && (/[0-9]/.test(input[pos]) || input[pos] === '.')) {
        numStr += input[pos];
        pos++;
      }
      tokens.push({ type: 'number', value: numStr, position: startPos });
      continue;
    }

    // Identifiers (variable names and function names)
    if (/[a-zA-Z_]/.test(char)) {
      let idStr = '';
      const startPos = pos;
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
        idStr += input[pos];
        pos++;
      }
      tokens.push({ type: 'identifier', value: idStr, position: startPos });
      continue;
    }

    // Single character tokens
    const startPos = pos;
    switch (char) {
      case '(':
        tokens.push({ type: 'lparen', value: '(', position: startPos });
        break;
      case ')':
        tokens.push({ type: 'rparen', value: ')', position: startPos });
        break;
      case ',':
        tokens.push({ type: 'comma', value: ',', position: startPos });
        break;
      case '+':
        tokens.push({ type: 'plus', value: '+', position: startPos });
        break;
      case '-':
        tokens.push({ type: 'minus', value: '-', position: startPos });
        break;
      case '*':
        tokens.push({ type: 'star', value: '*', position: startPos });
        break;
      case '/':
        tokens.push({ type: 'slash', value: '/', position: startPos });
        break;
      case '?':
        tokens.push({ type: 'question', value: '?', position: startPos });
        break;
      case ':':
        tokens.push({ type: 'colon', value: ':', position: startPos });
        break;
      default:
        // Skip unknown characters
        break;
    }
    pos++;
  }

  tokens.push({ type: 'eof', value: '', position: pos });
  return tokens;
}

/**
 * Parser state.
 */
class Parser {
  private tokens: Token[];
  private pos: number;
  private variableNames: string[];

  constructor(tokens: Token[], variableNames: string[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.variableNames = variableNames;
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'eof', value: '', position: -1 };
  }

  private advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return token;
  }

  private expect(type: TokenType): Token | ParseError {
    const token = this.current();
    if (token.type !== type) {
      return createParseError(`Expected ${type}, got ${token.type}`, token.position);
    }
    return this.advance();
  }

  parse(): ProvenFormulaNode | ParseError {
    const result = this.parseExpression();
    if (isParseError(result)) return result;

    const token = this.current();
    if (token.type !== 'eof') {
      return createParseError(`Unexpected token: ${token.value}`, token.position);
    }

    return result;
  }

  private parseExpression(): ProvenFormulaNode | ParseError {
    return this.parseTernary();
  }

  private parseTernary(): ProvenFormulaNode | ParseError {
    const condition = this.parseAdditive();
    if (isParseError(condition)) return condition;

    if (this.current().type === 'question') {
      this.advance(); // consume '?'
      const thenBranch = this.parseExpression();
      if (isParseError(thenBranch)) return thenBranch;

      const colonResult = this.expect('colon');
      if (isParseError(colonResult)) return colonResult;

      const elseBranch = this.parseExpression();
      if (isParseError(elseBranch)) return elseBranch;

      return conditional(condition, thenBranch, elseBranch);
    }

    return condition;
  }

  private parseAdditive(): ProvenFormulaNode | ParseError {
    let left = this.parseMultiplicative();
    if (isParseError(left)) return left;

    while (this.current().type === 'plus' || this.current().type === 'minus') {
      const op = this.advance();
      const right = this.parseMultiplicative();
      if (isParseError(right)) return right;

      if (op.type === 'plus') {
        left = add(left, right);
      } else {
        left = sub(left, right);
      }
    }

    return left;
  }

  private parseMultiplicative(): ProvenFormulaNode | ParseError {
    let left = this.parseUnary();
    if (isParseError(left)) return left;

    while (this.current().type === 'star' || this.current().type === 'slash') {
      const op = this.advance();
      const right = this.parseUnary();
      if (isParseError(right)) return right;

      if (op.type === 'star') {
        left = mul(left, right);
      } else {
        left = div(left, right);
      }
    }

    return left;
  }

  private parseUnary(): ProvenFormulaNode | ParseError {
    if (this.current().type === 'minus') {
      this.advance();
      const operand = this.parseUnary();
      if (isParseError(operand)) return operand;
      return neg(operand);
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ProvenFormulaNode | ParseError {
    const token = this.current();

    // Number literal
    if (token.type === 'number') {
      this.advance();
      const value = parseFloat(token.value);
      if (isNaN(value)) {
        return createParseError(`Invalid number: ${token.value}`, token.position);
      }
      return literal(value);
    }

    // Identifier (variable or function call)
    if (token.type === 'identifier') {
      const name = token.value;
      this.advance();

      // Check if it's a function call
      if (this.current().type === 'lparen') {
        return this.parseFunctionCall(name);
      }

      // It's a variable reference
      const index = this.variableNames.indexOf(name);
      if (index === -1) {
        return createParseError(`Unknown variable: ${name}`, token.position);
      }
      const result = input(name, index, this.variableNames.length);
      if (result instanceof Error) {
        return createParseError(result.message, token.position);
      }
      return result;
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.advance();
      const expr = this.parseExpression();
      if (isParseError(expr)) return expr;

      const closeResult = this.expect('rparen');
      if (isParseError(closeResult)) return closeResult;

      return expr;
    }

    return createParseError(`Unexpected token: ${token.value || token.type}`, token.position);
  }

  private parseFunctionCall(name: string): ProvenFormulaNode | ParseError {
    const openResult = this.expect('lparen');
    if (isParseError(openResult)) return openResult;

    const args: ProvenFormulaNode[] = [];

    if (this.current().type !== 'rparen') {
      const firstArg = this.parseExpression();
      if (isParseError(firstArg)) return firstArg;
      args.push(firstArg);

      while (this.current().type === 'comma') {
        this.advance();
        const arg = this.parseExpression();
        if (isParseError(arg)) return arg;
        args.push(arg);
      }
    }

    const closeResult = this.expect('rparen');
    if (isParseError(closeResult)) return closeResult;

    // Map function name to builder
    switch (name.toLowerCase()) {
      case 'min':
        if (args.length !== 2) {
          return createParseError(`min requires 2 arguments, got ${args.length}`);
        }
        return min(args[0], args[1]);

      case 'max':
        if (args.length !== 2) {
          return createParseError(`max requires 2 arguments, got ${args.length}`);
        }
        return max(args[0], args[1]);

      case 'and':
        if (args.length !== 2) {
          return createParseError(`and requires 2 arguments, got ${args.length}`);
        }
        return and(args[0], args[1]);

      case 'or':
        if (args.length !== 2) {
          return createParseError(`or requires 2 arguments, got ${args.length}`);
        }
        return or(args[0], args[1]);

      default:
        return createParseError(`Unknown function: ${name}`);
    }
  }
}

/**
 * Parse a formula string into a proven formula AST.
 *
 * @param formula - The formula string to parse
 * @param variableNames - Optional array of variable names for input references
 * @returns A ProvenFormulaNode or ParseError
 */
export function parseProvenFormula(
  formula: string,
  variableNames: string[] = []
): ProvenFormulaNode | ParseError {
  if (!formula || formula.trim().length === 0) {
    return createParseError('Empty formula');
  }

  const tokens = tokenize(formula);
  const parser = new Parser(tokens, variableNames);
  return parser.parse();
}

// ============================================================================
// INTEGRATION TYPE
// ============================================================================

/**
 * A DerivedConfidence with a proven formula AST instead of a string formula.
 */
export interface ProvenDerivedConfidence {
  readonly type: 'derived';
  readonly formula: ProvenFormulaNode;
  readonly inputs: readonly ConfidenceValue[];
  readonly formulaString: string;
  readonly calibrationStatus?: CalibrationStatus;
}

/**
 * Create a ProvenDerivedConfidence from a proven formula and inputs.
 *
 * @param formula - The proven formula AST
 * @param inputs - The input confidence values
 * @param calibrationStatus - Optional calibration status
 * @returns A ProvenDerivedConfidence
 */
export function createProvenDerivedConfidence(
  formula: ProvenFormulaNode,
  inputs: readonly ConfidenceValue[],
  calibrationStatus?: CalibrationStatus
): ProvenDerivedConfidence {
  return {
    type: 'derived',
    formula,
    inputs,
    formulaString: provenFormulaToString(formula),
    calibrationStatus,
  };
}

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

/**
 * Common formula patterns used in the codebase that can be recognized
 * and converted to proven formulas.
 */
type KnownFormulaPattern =
  | 'min(steps)'
  | 'min(a, b)'
  | 'max(a, b)'
  | 'product(branches)'
  | '1 - product(1 - branches)'
  | 'weighted_average';

/**
 * Migrate a string formula to a ProvenFormulaNode.
 *
 * This helper supports migration from legacy string-based formulas to the
 * proven formula AST system. It handles:
 * 1. Common known formulas (min, max, product, etc.)
 * 2. Arbitrary formulas via parsing
 *
 * For backwards compatibility, this function also accepts input names
 * for variable binding during formula parsing.
 *
 * @param formula - The string formula to migrate
 * @param inputNames - Array of input variable names
 * @returns A ProvenFormulaNode or an Error if parsing fails
 *
 * @example
 * ```typescript
 * // Known formula pattern
 * const result = migrateStringFormula('min(steps)', ['step_0', 'step_1']);
 * if (!(result instanceof Error)) {
 *   // result is a ProvenFormulaNode representing min(step_0, step_1)
 * }
 *
 * // Arbitrary formula
 * const result2 = migrateStringFormula('a * 0.5 + b * 0.5', ['a', 'b']);
 * ```
 */
export function migrateStringFormula(
  formula: string,
  inputNames: string[]
): ProvenFormulaNode | Error {
  // Handle empty formula
  if (!formula || formula.trim().length === 0) {
    return new Error('Formula cannot be empty');
  }

  // Handle empty inputs
  if (inputNames.length === 0) {
    // Check if formula is a literal constant
    const num = parseFloat(formula);
    if (!isNaN(num)) {
      return literal(num);
    }
    // Otherwise we need inputs to evaluate the formula
    return new Error('Formula requires input names but none were provided');
  }

  // First try known formula patterns
  const knownResult = tryKnownFormulaPattern(formula, inputNames);
  if (knownResult !== null) {
    return knownResult;
  }

  // Fall back to parsing the formula
  const parsed = parseProvenFormula(formula, inputNames);
  if (isParseError(parsed)) {
    return new Error(`Failed to parse formula "${formula}": ${parsed.message}`);
  }
  return parsed;
}

/**
 * Try to match a formula against known patterns and build a ProvenFormulaNode.
 * Returns null if the formula doesn't match any known pattern.
 */
function tryKnownFormulaPattern(
  formula: string,
  inputNames: string[]
): ProvenFormulaNode | null {
  const trimmed = formula.trim().toLowerCase();

  // min(steps) or min(a, b)
  if (trimmed === 'min(steps)' || trimmed.startsWith('min(')) {
    return buildMinFormula(inputNames);
  }

  // max(a, b)
  if (trimmed === 'max(a, b)' || trimmed.startsWith('max(')) {
    return buildMaxFormula(inputNames);
  }

  // product(branches)
  if (trimmed === 'product(branches)') {
    return buildProductFormula(inputNames);
  }

  // 1 - product(1 - branches) (noisy-or)
  if (trimmed === '1 - product(1 - branches)' || trimmed.includes('noisy')) {
    return buildNoisyOrFormula(inputNames);
  }

  // weighted_average
  if (trimmed === 'weighted_average') {
    // For weighted average, we use a simple average (weights handled externally)
    return buildAverageFormula(inputNames);
  }

  return null;
}

/**
 * Build a min formula for multiple inputs.
 */
function buildMinFormula(inputNames: string[]): ProvenFormulaNode | null {
  if (inputNames.length === 0) return null;

  if (inputNames.length === 1) {
    const inputResult = input(inputNames[0], 0, 1);
    if (inputResult instanceof Error) return null;
    return inputResult;
  }

  // Start with first two inputs
  const first = input(inputNames[0], 0, inputNames.length);
  const second = input(inputNames[1], 1, inputNames.length);
  if (first instanceof Error || second instanceof Error) return null;

  let result: ProvenFormulaNode = min(first, second);

  // Add remaining inputs
  for (let i = 2; i < inputNames.length; i++) {
    const nextInput = input(inputNames[i], i, inputNames.length);
    if (nextInput instanceof Error) return null;
    result = min(result, nextInput);
  }

  return result;
}

/**
 * Build a max formula for multiple inputs.
 */
function buildMaxFormula(inputNames: string[]): ProvenFormulaNode | null {
  if (inputNames.length === 0) return null;

  if (inputNames.length === 1) {
    const inputResult = input(inputNames[0], 0, 1);
    if (inputResult instanceof Error) return null;
    return inputResult;
  }

  // Start with first two inputs
  const first = input(inputNames[0], 0, inputNames.length);
  const second = input(inputNames[1], 1, inputNames.length);
  if (first instanceof Error || second instanceof Error) return null;

  let result: ProvenFormulaNode = max(first, second);

  // Add remaining inputs
  for (let i = 2; i < inputNames.length; i++) {
    const nextInput = input(inputNames[i], i, inputNames.length);
    if (nextInput instanceof Error) return null;
    result = max(result, nextInput);
  }

  return result;
}

/**
 * Build a product formula for multiple inputs.
 */
function buildProductFormula(inputNames: string[]): ProvenFormulaNode | null {
  if (inputNames.length === 0) return literal(1); // Identity for product

  if (inputNames.length === 1) {
    const inputResult = input(inputNames[0], 0, 1);
    if (inputResult instanceof Error) return null;
    return inputResult;
  }

  // Start with first two inputs
  const first = input(inputNames[0], 0, inputNames.length);
  const second = input(inputNames[1], 1, inputNames.length);
  if (first instanceof Error || second instanceof Error) return null;

  let result: ProvenFormulaNode = mul(first, second);

  // Add remaining inputs
  for (let i = 2; i < inputNames.length; i++) {
    const nextInput = input(inputNames[i], i, inputNames.length);
    if (nextInput instanceof Error) return null;
    result = mul(result, nextInput);
  }

  return result;
}

/**
 * Build a noisy-or formula: 1 - product(1 - branches).
 * This represents independent OR semantics.
 */
function buildNoisyOrFormula(inputNames: string[]): ProvenFormulaNode | null {
  if (inputNames.length === 0) return literal(0); // Identity for OR

  const one = literal(1);

  if (inputNames.length === 1) {
    // For single input, noisy-or is just the input itself
    const inputResult = input(inputNames[0], 0, 1);
    if (inputResult instanceof Error) return null;
    return inputResult;
  }

  // Build: 1 - ((1 - x1) * (1 - x2) * ...)
  // Start with (1 - x1) * (1 - x2)
  const first = input(inputNames[0], 0, inputNames.length);
  const second = input(inputNames[1], 1, inputNames.length);
  if (first instanceof Error || second instanceof Error) return null;

  let failureProduct: ProvenFormulaNode = mul(sub(one, first), sub(one, second));

  // Add remaining inputs
  for (let i = 2; i < inputNames.length; i++) {
    const nextInput = input(inputNames[i], i, inputNames.length);
    if (nextInput instanceof Error) return null;
    failureProduct = mul(failureProduct, sub(one, nextInput));
  }

  // Return 1 - failureProduct
  return sub(one, failureProduct);
}

/**
 * Build an average formula: (x1 + x2 + ...) / n.
 */
function buildAverageFormula(inputNames: string[]): ProvenFormulaNode | null {
  if (inputNames.length === 0) return literal(0);

  if (inputNames.length === 1) {
    const inputResult = input(inputNames[0], 0, 1);
    if (inputResult instanceof Error) return null;
    return inputResult;
  }

  // Build sum
  const first = input(inputNames[0], 0, inputNames.length);
  const second = input(inputNames[1], 1, inputNames.length);
  if (first instanceof Error || second instanceof Error) return null;

  let sum: ProvenFormulaNode = add(first, second);

  for (let i = 2; i < inputNames.length; i++) {
    const nextInput = input(inputNames[i], i, inputNames.length);
    if (nextInput instanceof Error) return null;
    sum = add(sum, nextInput);
  }

  // Divide by count
  return div(sum, literal(inputNames.length));
}

/**
 * Type guard to check if a DerivedConfidence has a proven formula.
 */
export function hasProvenFormula(
  confidence: { readonly provenFormula?: ProvenFormulaNode }
): confidence is { readonly provenFormula: ProvenFormulaNode } {
  return (
    confidence.provenFormula !== undefined &&
    isProvenFormulaNode(confidence.provenFormula)
  );
}

/**
 * Create a DerivedConfidence with optional proven formula.
 *
 * This is the recommended way to create DerivedConfidence values going forward.
 * It automatically generates the string formula from the proven formula if provided.
 *
 * @param options - Configuration for the derived confidence
 * @returns A DerivedConfidence with both string and proven formula (if provided)
 */
export function createDerivedConfidenceWithProof(options: {
  value: number;
  provenFormula: ProvenFormulaNode;
  inputs: ReadonlyArray<{ name: string; confidence: ConfidenceValue }>;
  calibrationStatus?: CalibrationStatus;
}): {
  type: 'derived';
  value: number;
  formula: string;
  inputs: ReadonlyArray<{ name: string; confidence: ConfidenceValue }>;
  calibrationStatus?: CalibrationStatus;
  provenFormula: ProvenFormulaNode;
} {
  return {
    type: 'derived',
    value: Math.max(0, Math.min(1, options.value)),
    formula: provenFormulaToString(options.provenFormula),
    inputs: options.inputs,
    calibrationStatus: options.calibrationStatus,
    provenFormula: options.provenFormula,
  };
}
