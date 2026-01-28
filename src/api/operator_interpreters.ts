import type { TechniqueComposition, TechniqueOperator, TechniqueOperatorType, TechniquePrimitive } from '../strategic/techniques.js';
import type { PrimitiveExecutionResult } from './technique_execution.js';
import type { GovernorContext } from './governor_context.js';
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types as utilTypes } from 'node:util';

export type EscalationLevel = 'agent' | 'team' | 'human' | 'emergency';

export type OperatorExecutionResult =
  | { type: 'continue'; outputs: Record<string, unknown> }
  | { type: 'skip'; reason: string }
  | { type: 'retry'; delay: number; attempt: number }
  | { type: 'branch'; target: string }
  | { type: 'terminate'; reason: string; graceful: boolean }
  | { type: 'escalate'; level: EscalationLevel; context: unknown }
  | { type: 'checkpoint'; reason: string; state: Record<string, unknown>; terminate?: boolean };

export interface OperatorContext {
  operator: TechniqueOperator;
  composition: TechniqueComposition;
  // Operator-local scratch state shared across interpreter calls for this operator.
  state: Record<string, unknown>;
  // Shared execution state visible to operator conditions and merged outputs.
  executionState: Record<string, unknown>;
  attempt: number;
  startedAt: Date;
  governor?: GovernorContext;
  agents?: AgentContext[];
}

export interface OperatorInterpreter {
  readonly operatorType: TechniqueOperatorType;
  beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult>;
  afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult>;
  afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult>;
}

export interface AgentContext {
  id: string;
  name?: string;
  role?: string;
}

const CONDITION_COMPARATORS = ['>=', '<=', '!=', '==', '>', '<'] as const;
const FORBIDDEN_STATE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
]);
const FORBIDDEN_STATE_KEYS_LOWER = new Set(Array.from(FORBIDDEN_STATE_KEYS, (key) => key.toLowerCase()));
const FORBIDDEN_STATE_KEYS_STRIPPED = new Set(
  Array.from(FORBIDDEN_STATE_KEYS, (key) => key.toLowerCase().replace(/_/g, ''))
);
const MAX_CONDITION_TOKENS = 100;
const MAX_CONDITION_DEPTH = 24;
const MAX_CONDITION_LENGTH = 4096;
const MAX_CONDITION_NODES = 200;
const MAX_CONDITION_ERRORS = 100;
const MAX_CONDITION_OPERATIONS = 1000;
const MAX_CONDITION_STATE_NODES = 5000;
const MAX_CONDITION_STATE_DEPTH = 12;
const MAX_STRING_LITERAL_LENGTH = 1024;
const MAX_STATE_PATH_LENGTH = 512;
const MAX_STATE_PATH_SEGMENTS = 12;
const MAX_STATE_SEGMENT_LENGTH = 64;
const MAX_STATE_SEGMENT_REPEAT = 4;
const MAX_OUTPUT_KEY_LENGTH = 120;
const MAX_OPERATOR_KEY_LENGTH = 64;
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9_]+$/;
const SAFE_NAMESPACE_PATTERN = /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/;
const CONDITION_TYPE_MISMATCH = 'condition_type_mismatch';
const CONDITION_TIMEOUT = 'condition_timeout';
const CONDITION_DEPTH_EXCEEDED = 'condition_depth_exceeded';
const CONDITION_BUDGET_EXCEEDED = 'condition_budget_exceeded';
const CONDITION_STATE_TRUNCATED = 'condition_state_truncated';
const MAX_LOOP_ITERATIONS = 100;
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_CIRCUIT_THRESHOLD = 5;
const DEFAULT_CIRCUIT_RESET_MS = 60000;
const DEFAULT_TIMEBOX_MS = 60000;
const MAX_BACKOFF_DELAY_MS = 60000;
const MAX_PARALLEL_COLLISIONS = 1000;
const MAX_PARALLEL_SKIPPED_KEYS = 1000;
const MAX_MERGE_COLLISIONS = 200;
const MAX_MERGE_SKIPPED_KEYS = 200;
const MAX_CONDITION_EVAL_MS = 50;
const MAX_MIGRATION_KEYS = 100;
const MAX_MIGRATION_DEPTH = 4;
const MAX_MIGRATION_ARRAY_LENGTH = 50;
const MAX_MERGE_ARRAY_DEPTH = 3;
const MAX_CHECKPOINT_OUTPUT_NODES = 2000;
const MAX_CHECKPOINT_OUTPUT_DEPTH = 6;
const MAX_CHECKPOINT_ARRAY_LENGTH = 200;
const NON_ASCII_PATTERN = /[^\x00-\x7F]/;
const COMBINING_MARK_PATTERN = /\p{M}/u;
const OPERATOR_STATE_KEY = '__operator_state';

function getStringParam(params: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function getNumberParam(
  params: Record<string, unknown> | undefined,
  keys: string[],
  options?: { min?: number; max?: number }
): number | undefined {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (options?.min !== undefined && value < options.min) continue;
      if (options?.max !== undefined && value > options.max) continue;
      return value;
    }
  }
  return undefined;
}

function parseCondition(condition: string): { expression: string; target?: string } {
  const parts = condition.split('=>');
  if (parts.length >= 2) {
    const expression = (parts[0] ?? '').trim();
    const target = parts.slice(1).join('=>').trim();
    return { expression, target: target.length > 0 ? target : undefined };
  }
  return { expression: condition.trim() };
}

type ConditionToken =
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'operator'; value: 'AND' | 'OR' | 'NOT' | '==' | '!=' | '>=' | '<=' | '>' | '<' }
  | { type: 'literal'; value: boolean | null | number | string }
  | { type: 'identifier'; value: string };

type ConditionComparator = (typeof CONDITION_COMPARATORS)[number];
type ConditionBinaryOp = ConditionComparator | 'and' | 'or';

type ConditionExpr =
  | { type: 'literal'; value: boolean | null | number | string }
  | { type: 'path'; path: string }
  | { type: 'exists'; path: string }
  | { type: 'unary'; op: 'not'; expr: ConditionExpr }
  | { type: 'binary'; op: ConditionBinaryOp; left: ConditionExpr; right: ConditionExpr };

function tokenizeCondition(expression: string): { ok: true; tokens: ConditionToken[] } | { ok: false; error: string } {
  if (expression.length > MAX_CONDITION_LENGTH) {
    return { ok: false, error: 'condition too long' };
  }
  const tokens: ConditionToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const ch = expression[index] ?? '';
    const nextChar = index + 1 < expression.length ? (expression[index + 1] ?? '') : '';
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      index += 1;
      continue;
    }

    if (ch === '&' && nextChar === '&') {
      tokens.push({ type: 'operator', value: 'AND' });
      index += 2;
      continue;
    }
    if (ch === '|' && nextChar === '|') {
      tokens.push({ type: 'operator', value: 'OR' });
      index += 2;
      continue;
    }
    if (ch === '!' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '!=' });
      index += 2;
      continue;
    }
    if (ch === '=' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '==' });
      index += 2;
      continue;
    }
    if (ch === '>' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '>=' });
      index += 2;
      continue;
    }
    if (ch === '<' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '<=' });
      index += 2;
      continue;
    }
    if (ch === '>') {
      tokens.push({ type: 'operator', value: '>' });
      index += 1;
      continue;
    }
    if (ch === '<') {
      tokens.push({ type: 'operator', value: '<' });
      index += 1;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'operator', value: 'NOT' });
      index += 1;
      continue;
    }

    if (ch === '"') {
      let cursor = index + 1;
      let value = '';
      let closed = false;
      while (cursor < expression.length) {
        const next = expression[cursor] ?? '';
        if (next === '\\' && cursor + 1 < expression.length) {
          const escaped = expression[cursor + 1] ?? '';
          switch (escaped) {
            case '"':
              value += '"';
              break;
            case '\\':
              value += '\\';
              break;
            case 'n':
              value += '\n';
              break;
            case 'r':
              value += '\r';
              break;
            case 't':
              value += '\t';
              break;
            default:
              return { ok: false, error: 'invalid escape sequence' };
          }
          cursor += 2;
          continue;
        }
        if (next === '"') {
          closed = true;
          cursor += 1;
          break;
        }
        value += next;
        if (value.length > MAX_STRING_LITERAL_LENGTH) {
          return { ok: false, error: 'string literal too long' };
        }
        cursor += 1;
      }
      if (!closed) {
        return { ok: false, error: 'unterminated string literal' };
      }
      if (value.includes('\u0000')) {
        return { ok: false, error: 'null byte in string literal' };
      }
      for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
          return { ok: false, error: 'control character in string literal' };
        }
      }
      tokens.push({ type: 'literal', value });
      index = cursor;
      continue;
    }

    if (ch === '-' || /[0-9]/.test(ch)) {
      const match = expression.slice(index).match(/^-?\d+(?:\.\d+)?/);
      if (match) {
        tokens.push({ type: 'literal', value: Number(match[0]) });
        index += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_]/.test(ch)) {
      const match = /[A-Za-z0-9_.]+/.exec(expression.slice(index));
      if (!match) {
        return { ok: false, error: 'invalid identifier' };
      }
      const raw = match[0];
      const upper = raw.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        tokens.push({ type: 'operator', value: upper as 'AND' | 'OR' | 'NOT' });
      } else if (raw === 'true') {
        tokens.push({ type: 'literal', value: true });
      } else if (raw === 'false') {
        tokens.push({ type: 'literal', value: false });
      } else if (raw === 'null') {
        tokens.push({ type: 'literal', value: null });
      } else {
        tokens.push({ type: 'identifier', value: raw });
      }
      index += raw.length;
      continue;
    }

    return { ok: false, error: `unexpected token: ${ch}` };
  }

  if (tokens.length > MAX_CONDITION_TOKENS) {
    return { ok: false, error: 'condition too complex' };
  }

  return { ok: true, tokens };
}

function parseConditionExpression(expression: string): ConditionExpr | null {
  const tokenResult = tokenizeCondition(expression);
  if (!tokenResult.ok) return null;
  const tokens = tokenResult.tokens;
  let cursor = 0;
  let nodeCount = 0;
  let operationCount = 0;

  const peek = () => tokens[cursor];
  const advance = () => tokens[cursor++];
  const makeNode = (node: ConditionExpr): ConditionExpr | null => {
    nodeCount += 1;
    if (nodeCount > MAX_CONDITION_NODES) return null;
    return node;
  };
  const tick = (): boolean => {
    operationCount += 1;
    return operationCount <= MAX_CONDITION_OPERATIONS;
  };
  const matchOperator = (value: ConditionToken['value']): boolean => {
    if (!tick()) return false;
    const token = peek();
    if (token && token.type === 'operator' && token.value === value) {
      cursor += 1;
      return true;
    }
    return false;
  };
  const matchParen = (value: '(' | ')'): boolean => {
    if (!tick()) return false;
    const token = peek();
    if (token && token.type === 'paren' && token.value === value) {
      cursor += 1;
      return true;
    }
    return false;
  };

  const parsePrimary = (depth: number): ConditionExpr | null => {
    if (depth > MAX_CONDITION_DEPTH) return null;
    if (!tick()) return null;
    const token = peek();
    if (!token) return null;
    if (token.type === 'paren' && token.value === '(') {
      advance();
      const expr = parseOr(depth + 1);
      if (!matchParen(')')) return null;
      return expr;
    }
    if (token.type === 'literal') {
      advance();
      return makeNode({ type: 'literal', value: token.value });
    }
    if (token.type === 'identifier') {
      advance();
      const parsed = parseStatePath(token.value);
      if (!parsed) return null;
      if (parsed.endsWith('.exists')) {
        const path = parsed.slice(0, -'.exists'.length);
        if (!isSafeStatePath(path)) return null;
        return makeNode({ type: 'exists', path });
      }
      if (!isSafeStatePath(parsed)) return null;
      return makeNode({ type: 'path', path: parsed });
    }
    return null;
  };

  const parseComparison = (depth: number): ConditionExpr | null => {
    if (depth > MAX_CONDITION_DEPTH) return null;
    if (!tick()) return null;
    let left = parsePrimary(depth);
    if (!left) return null;
    const token = peek();
    if (token && token.type === 'operator' && CONDITION_COMPARATORS.includes(token.value as ConditionComparator)) {
      advance();
      const right = parsePrimary(depth);
      if (!right) return null;
      const next = makeNode({ type: 'binary', op: token.value as ConditionComparator, left, right });
      if (!next) return null;
      left = next;
    }
    return left;
  };

  const parseNot = (depth: number): ConditionExpr | null => {
    if (depth > MAX_CONDITION_DEPTH) return null;
    if (!tick()) return null;
    if (matchOperator('NOT')) {
      const expr = parseNot(depth + 1);
      if (!expr) return null;
      return makeNode({ type: 'unary', op: 'not', expr });
    }
    return parseComparison(depth);
  };

  const parseAnd = (depth: number): ConditionExpr | null => {
    if (depth > MAX_CONDITION_DEPTH) return null;
    if (!tick()) return null;
    let left = parseNot(depth);
    if (!left) return null;
    while (matchOperator('AND')) {
      if (!tick()) return null;
      const right = parseNot(depth);
      if (!right) return null;
      const next = makeNode({ type: 'binary', op: 'and', left, right });
      if (!next) return null;
      left = next;
    }
    return left;
  };

  const parseOr = (depth: number): ConditionExpr | null => {
    if (depth > MAX_CONDITION_DEPTH) return null;
    if (!tick()) return null;
    let left = parseAnd(depth);
    if (!left) return null;
    while (matchOperator('OR')) {
      if (!tick()) return null;
      const right = parseAnd(depth);
      if (!right) return null;
      const next = makeNode({ type: 'binary', op: 'or', left, right });
      if (!next) return null;
      left = next;
    }
    return left;
  };

  const parsed = parseOr(0);
  if (!parsed) return null;
  if (cursor !== tokens.length) {
    return null;
  }
  return parsed;
}

function isForbiddenStateKey(key: string): boolean {
  if (FORBIDDEN_STATE_KEYS.has(key)) return true;
  return FORBIDDEN_STATE_KEYS_LOWER.has(key.toLowerCase());
}

function resolveStatePath(path: string, state: Record<string, unknown>): unknown {
  if (!state || typeof state !== 'object') return undefined;
  const stateProto = Object.getPrototypeOf(state);
  if (stateProto !== null && stateProto !== Object.prototype) return undefined;
  if (state === Object.prototype) return undefined;
  if (typeof utilTypes.isProxy === 'function' && utilTypes.isProxy(state)) return undefined;
  if (Object.getOwnPropertySymbols(state).length > 0) return undefined;
  const normalized = path.replace(/^state\./, '');
  const parts = normalized.split('.').filter(Boolean);
  let value: unknown = state;
  for (const part of parts) {
    if (isForbiddenStateKey(part)) return undefined;
    if (!value || typeof value !== 'object') return undefined;
    const container = value as Record<string, unknown>;
    const containerProto = Object.getPrototypeOf(container);
    if (containerProto !== null && containerProto !== Object.prototype) return undefined;
    if (container === Object.prototype) return undefined;
    if (typeof utilTypes.isProxy === 'function' && utilTypes.isProxy(container)) return undefined;
    if (Object.getOwnPropertySymbols(container).length > 0) return undefined;
    if (!Object.prototype.hasOwnProperty.call(container, part)) return undefined;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(container, part);
    } catch {
      return undefined;
    }
    if (!descriptor) return undefined;
    if (descriptor.get || descriptor.set) return undefined;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined;
    try {
      value = descriptor.value;
    } catch {
      return undefined;
    }
  }
  return value;
}

function parseStatePath(path: string): string | null {
  if (!path.startsWith('state.')) return null;
  return path;
}

function isSafeSegment(segment: string): boolean {
  if (!segment) return false;
  if (NON_ASCII_PATTERN.test(segment)) return false;
  const normalized = segment.normalize('NFKC');
  if (normalized !== segment) return false;
  if (NON_ASCII_PATTERN.test(normalized)) return false;
  if (normalized.length > MAX_STATE_SEGMENT_LENGTH) return false;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!(isDigit || isUpper || isLower || code === 95)) {
      return false;
    }
  }
  return true;
}

function isSafeStatePath(path: string): boolean {
  if (!path.startsWith('state.')) return false;
  const normalized = path.normalize('NFKC');
  if (normalized !== path) return false;
  if (NON_ASCII_PATTERN.test(normalized)) return false;
  if (normalized.length > MAX_STATE_PATH_LENGTH) return false;
  const segments = normalized.replace(/^state\./, '').split('.').filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_STATE_PATH_SEGMENTS) return false;
  if (segments.some((segment) => isForbiddenStateKey(segment))) return false;
  const counts = new Map<string, number>();
  for (const segment of segments) {
    const nextCount = (counts.get(segment) ?? 0) + 1;
    if (nextCount > MAX_STATE_SEGMENT_REPEAT) return false;
    counts.set(segment, nextCount);
  }
  return segments.every((segment) => isSafeSegment(segment));
}

function recordConditionError(errors: string[], code: string): void {
  if (errors.length >= MAX_CONDITION_ERRORS) return;
  errors.push(code);
}

function monotonicNowMs(): number | null {
  try {
    const value = performance.now();
    if (Number.isFinite(value)) return value;
  } catch {
    // Fall through to wallclock.
  }
  const fallback = Date.now();
  return Number.isFinite(fallback) ? fallback : null;
}

function normalizeConditionState(
  input: Record<string, unknown>
): { state: Record<string, unknown>; truncated: boolean } {
  // Condition evaluation only supports acyclic, plain objects; cycles become sentinels.
  const seen = new WeakSet<object>();
  let nodeCount = 0;
  let truncated = false;
  const freezeSafely = <T extends object>(value: T): T | Record<string, unknown> => {
    try {
      const frozen = Object.freeze(value);
      if (!Object.isFrozen(frozen)) {
        truncated = true;
        return Object.create(null);
      }
      return frozen;
    } catch {
      truncated = true;
      return Object.create(null);
    }
  };
  const normalize = (value: unknown, depth: number): unknown => {
    if (nodeCount >= MAX_CONDITION_STATE_NODES || depth > MAX_CONDITION_STATE_DEPTH) {
      truncated = true;
      return Object.create(null);
    }
    nodeCount += 1;
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const normalizedArray = value.map((entry) => normalize(entry, depth + 1));
      return freezeSafely(normalizedArray);
    }
    if (seen.has(value)) {
      const circular: Record<string, unknown> = Object.create(null);
      circular.__circular = true;
      return circular;
    }
    seen.add(value);
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return Object.create(null);
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenStateKey(key)) continue;
      result[key] = normalize(child, depth + 1);
    }
    return freezeSafely(result);
  };
  const normalized = normalize(input, 0);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return { state: Object.create(null), truncated };
  }
  return { state: normalized as Record<string, unknown>, truncated };
}

function evaluateBinaryCondition(
  op: ConditionBinaryOp,
  left: unknown,
  right: unknown,
  errors: string[]
): unknown {
  switch (op) {
    case 'and':
      return Boolean(left) && Boolean(right);
    case 'or':
      return Boolean(left) || Boolean(right);
    case '==':
      if (left === undefined || right === undefined || left === null || right === null) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      if (typeof left !== typeof right) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      return left === right;
    case '!=':
      if (left === undefined || right === undefined || left === null || right === null) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      if (typeof left !== typeof right) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      return left !== right;
    case '>':
      if (left === undefined || right === undefined) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      return left > right;
    case '>=':
      if (left === undefined || right === undefined) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      return left >= right;
    case '<':
      if (left === undefined || right === undefined) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      return left < right;
    case '<=':
      if (left === undefined || right === undefined) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
        recordConditionError(errors, CONDITION_TYPE_MISMATCH);
        return undefined;
      }
      return left <= right;
    default:
      return false;
  }
}

function evaluateConditionExpression(
  expr: ConditionExpr,
  state: Record<string, unknown>,
  errors: string[],
  deadlineMs: number | null,
  depth: number,
  remainingOps: number
): unknown {
  if (errors.length >= MAX_CONDITION_ERRORS) return undefined;
  const isTimedOut = (deadline: number | null): boolean => {
    if (deadline === null) return false;
    const now = monotonicNowMs();
    return now !== null && now > deadline;
  };
  let opsRemaining = remainingOps;
  const valueStack: unknown[] = [];
  type Frame = { node: ConditionExpr; depth: number; stage: 'enter' | 'exit' };
  const stack: Frame[] = [{ node: expr, depth, stage: 'enter' }];

  while (stack.length > 0) {
    if (errors.length >= MAX_CONDITION_ERRORS) return undefined;
    if (isTimedOut(deadlineMs)) {
      recordConditionError(errors, CONDITION_TIMEOUT);
      return undefined;
    }
    const frame = stack.pop();
    if (!frame) break;
    if (opsRemaining <= 0) {
      recordConditionError(errors, CONDITION_BUDGET_EXCEEDED);
      return undefined;
    }

    if (frame.stage === 'enter') {
      if (frame.depth > MAX_CONDITION_DEPTH) {
        recordConditionError(errors, CONDITION_DEPTH_EXCEEDED);
        return undefined;
      }
      opsRemaining -= 1 + Math.floor(frame.depth / 4);
      if (isTimedOut(deadlineMs)) {
        recordConditionError(errors, CONDITION_TIMEOUT);
        return undefined;
      }
      switch (frame.node.type) {
        case 'literal':
          valueStack.push(frame.node.value);
          break;
        case 'path':
          if (!isSafeStatePath(frame.node.path)) {
            valueStack.push(undefined);
            break;
          }
          valueStack.push(resolveStatePath(frame.node.path, state));
          break;
        case 'exists':
          if (!isSafeStatePath(frame.node.path)) {
            valueStack.push(false);
            break;
          }
          valueStack.push(resolveStatePath(frame.node.path, state) !== undefined);
          break;
        case 'unary':
          stack.push({ node: frame.node, depth: frame.depth, stage: 'exit' });
          stack.push({ node: frame.node.expr, depth: frame.depth + 1, stage: 'enter' });
          break;
        case 'binary':
          stack.push({ node: frame.node, depth: frame.depth, stage: 'exit' });
          stack.push({ node: frame.node.right, depth: frame.depth + 1, stage: 'enter' });
          stack.push({ node: frame.node.left, depth: frame.depth + 1, stage: 'enter' });
          break;
        default:
          valueStack.push(false);
      }
      continue;
    }

    switch (frame.node.type) {
      case 'unary': {
        const operand = valueStack.pop();
        if (frame.node.op === 'not') {
          valueStack.push(!Boolean(operand));
        } else {
          valueStack.push(false);
        }
        break;
      }
      case 'binary': {
        const right = valueStack.pop();
        const left = valueStack.pop();
        valueStack.push(evaluateBinaryCondition(frame.node.op, left, right, errors));
        break;
      }
      default:
        break;
    }
  }

  if (valueStack.length !== 1) return undefined;
  return valueStack[0];
}

export function evaluateOperatorCondition(
  condition: string,
  state: Record<string, unknown>
): { matched: boolean; target?: string } {
  const parsed = parseCondition(condition);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { matched: false, target: parsed.target };
  }
  const expr = parseConditionExpression(parsed.expression);
  if (!expr) {
    return { matched: false, target: parsed.target };
  }
  const errors: string[] = [];
  const { state: evaluationState, truncated } = normalizeConditionState(state);
  if (truncated) {
    recordConditionError(errors, CONDITION_STATE_TRUNCATED);
  }
  const startMs = monotonicNowMs();
  const deadlineMs = startMs === null ? null : startMs + MAX_CONDITION_EVAL_MS;
  const result = evaluateConditionExpression(
    expr,
    evaluationState,
    errors,
    deadlineMs,
    0,
    MAX_CONDITION_OPERATIONS
  );
  if (errors.length > 0) {
    const existing = Array.isArray(state.__condition_errors) ? state.__condition_errors : [];
    state.__condition_errors = [...existing, ...errors].slice(0, MAX_CONDITION_ERRORS);
    return { matched: false, target: parsed.target };
  }
  return { matched: Boolean(result), target: parsed.target };
}

function getConditionTarget(
  conditionIndex: number,
  conditionTarget: string | undefined,
  operator: TechniqueOperator
): string | undefined {
  if (conditionTarget) return conditionTarget;
  if (operator.outputs && operator.outputs[conditionIndex]) return operator.outputs[conditionIndex];
  const defaultTarget = getStringParam(operator.parameters, ['default', 'defaultTarget']);
  if (defaultTarget) return defaultTarget;
  return undefined;
}

function normalizeFailureMode(operator: TechniqueOperator): string {
  return getStringParam(operator.parameters, ['failureMode', 'mode']) ?? 'fail_fast';
}

type MergeStrategy = 'array' | 'first' | 'last' | 'reject';

function normalizeMergeStrategy(operator: TechniqueOperator): MergeStrategy {
  const strategy = getStringParam(operator.parameters, ['mergeStrategy', 'collisionStrategy', 'strategy']) ?? 'array';
  switch (strategy) {
    case 'first':
    case 'last':
    case 'array':
    case 'reject':
      return strategy;
    default:
      return 'array';
  }
}

function sanitizeOperatorKey(value: string): string {
  if (!value) return 'operator';
  const normalized = value.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!normalized) return 'operator';
  return normalized.length > MAX_OPERATOR_KEY_LENGTH
    ? normalized.slice(0, MAX_OPERATOR_KEY_LENGTH)
    : normalized;
}

function resolveOperatorOutputKey(operator: TechniqueOperator, prefix: string): string {
  const candidate = getStringParam(operator.parameters, ['outputKey', 'targetKey', 'resultKey']);
  const safe = candidate ? sanitizeOutputKey(candidate) : null;
  if (safe) return safe;
  return `${prefix}_${sanitizeOperatorKey(operator.id)}`;
}

function mergeIntoState(target: Record<string, unknown>, output: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(output)) {
    if (isForbiddenStateKey(key)) continue;
    target[key] = value;
  }
}

function ensureOutputs(outputs: Record<string, unknown> | undefined): Record<string, unknown> {
  return outputs ?? {};
}

function sanitizeOutputKey(key: string): string | null {
  if (key.length > MAX_OUTPUT_KEY_LENGTH) return null;
  if (COMBINING_MARK_PATTERN.test(key)) return null;
  if (NON_ASCII_PATTERN.test(key)) return null;
  const normalizedInput = key.normalize('NFKC');
  if (normalizedInput.length > MAX_OUTPUT_KEY_LENGTH) return null;
  if (COMBINING_MARK_PATTERN.test(normalizedInput)) return null;
  if (NON_ASCII_PATTERN.test(normalizedInput)) return null;
  const trimmed = normalizedInput.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_OUTPUT_KEY_LENGTH) return null;
  if (!SAFE_SEGMENT_PATTERN.test(trimmed)) return null;
  if (isForbiddenStateKey(trimmed)) return null;
  if (trimmed.includes('__')) return null;
  const stripped = trimmed.toLowerCase().replace(/_/g, '');
  if (FORBIDDEN_STATE_KEYS_STRIPPED.has(stripped)) return null;
  return trimmed;
}

function sanitizeCheckpointValue(
  value: unknown,
  state: { nodes: number; truncated: boolean; seen: WeakSet<object>; circulars: number; truncations: number },
  depth = 0
): unknown {
  if (state.nodes >= MAX_CHECKPOINT_OUTPUT_NODES || depth > MAX_CHECKPOINT_OUTPUT_DEPTH) {
    state.truncated = true;
    state.truncations += 1;
    return '[Truncated]';
  }
  state.nodes += 1;
  if (value === null || value === undefined) return value;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value;
  if (valueType !== 'object') return String(value);
  if (state.seen.has(value as object)) {
    state.circulars += 1;
    return '[Circular]';
  }
  state.seen.add(value as object);
  if (Array.isArray(value)) {
    const slice = value.slice(0, MAX_CHECKPOINT_ARRAY_LENGTH);
    return slice.map((entry) => sanitizeCheckpointValue(entry, state, depth + 1));
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenStateKey(key)) continue;
    result[key] = sanitizeCheckpointValue(child, state, depth + 1);
  }
  return result;
}

function sanitizeCheckpointOutputs(entries: Array<{ primitiveId: string; output: unknown; reason?: string }>): {
  entries: Array<{ primitiveId: string; output: unknown; reason?: string }>;
  truncated: boolean;
  circulars: number;
  truncations: number;
} {
  const state = { nodes: 0, truncated: false, seen: new WeakSet<object>(), circulars: 0, truncations: 0 };
  const sanitized = entries.map((entry) => ({
    primitiveId: entry.primitiveId,
    output: sanitizeCheckpointValue(entry.output, state),
    ...(entry.reason ? { reason: entry.reason } : {}),
  }));
  return { entries: sanitized, truncated: state.truncated, circulars: state.circulars, truncations: state.truncations };
}

function sanitizeCheckpointRecord(value: Record<string, unknown>): Record<string, unknown> {
  const state = { nodes: 0, truncated: false, seen: new WeakSet<object>(), circulars: 0, truncations: 0 };
  const sanitized = sanitizeCheckpointValue(value, state);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return Object.create(null);
  }
  return sanitized as Record<string, unknown>;
}

function isMergeSafeValue(value: unknown, depth = 0): boolean {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return true;
  if (Array.isArray(value)) {
    if (depth >= MAX_MERGE_ARRAY_DEPTH) return false;
    return value.every((entry) => isMergeSafeValue(entry, depth + 1));
  }
  return false;
}

function isSafeStateContainer(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null;
}

function createOperatorState(): Record<string, unknown> {
  const target = Object.create(null) as Record<string, unknown>;
  const sanitizeProp = (prop: string | symbol) => {
    const raw = String(prop);
    const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '');
    return stripped.length > 64 ? `${stripped.slice(0, 64)}…` : stripped;
  };
  const reject = (prop: string | symbol) => {
    throw new TypeError(`Operator state mutation rejected for key: ${sanitizeProp(prop)}`);
  };
  return new Proxy(target, {
    set(obj, prop, value) {
      if (typeof prop === 'symbol') return reject(prop);
      if (typeof prop === 'string' && isForbiddenStateKey(prop)) return reject(prop);
      obj[prop] = value;
      return true;
    },
    defineProperty(obj, prop, descriptor) {
      if (typeof prop === 'symbol') return reject(prop);
      if (typeof prop === 'string' && isForbiddenStateKey(prop)) return reject(prop);
      return Reflect.defineProperty(obj, prop, descriptor);
    },
    deleteProperty(obj, prop) {
      if (typeof prop === 'symbol') return reject(prop);
      if (typeof prop === 'string' && isForbiddenStateKey(prop)) return reject(prop);
      return Reflect.deleteProperty(obj, prop);
    },
  });
}

function sanitizeMigratedValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown | undefined {
  if (depth > MAX_MIGRATION_DEPTH) return undefined;
  if (value === null) return value;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_MIGRATION_ARRAY_LENGTH) return undefined;
    const normalized: unknown[] = [];
    for (const entry of value) {
      const sanitized = sanitizeMigratedValue(entry, depth + 1, seen);
      if (sanitized === undefined) return undefined;
      normalized.push(sanitized);
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return undefined;
    seen.add(value);
  }
  return undefined;
}

function coerceLegacyState(source: unknown): Record<string, unknown> | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const proto = Object.getPrototypeOf(source);
  if (proto === null) return source as Record<string, unknown>;
  if (proto !== Object.prototype) return null;
  const clone: Record<string, unknown> = Object.create(null);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (isForbiddenStateKey(key)) continue;
    if (descriptor.get || descriptor.set) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    clone[key] = descriptor.value;
  }
  return clone;
}

function migrateOperatorState(
  target: Record<string, unknown>,
  source: unknown,
  reason: string
): void {
  if (!source || typeof source !== 'object') return;
  if (Object.getPrototypeOf(source) !== null) return;
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const seen = new WeakSet<object>();
  const staged: Array<[string, unknown]> = [];
  let truncated = false;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, key)) continue;
    if (key === OPERATOR_STATE_KEY || isForbiddenStateKey(key)) continue;
    if (descriptor.get || descriptor.set) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    if (staged.length >= MAX_MIGRATION_KEYS) {
      truncated = true;
      break;
    }
    const sanitized = sanitizeMigratedValue(descriptor.value, 0, seen);
    if (sanitized === undefined) continue;
    if (Object.prototype.hasOwnProperty.call(target, key)) continue;
    staged.push([key, sanitized]);
  }
  if (staged.length === 0 && !truncated) return;
  for (const [key, value] of staged) {
    target[key] = value;
  }
  if (staged.length > 0 && !Object.prototype.hasOwnProperty.call(target, '__operator_state_migrated')) {
    target.__operator_state_migrated = reason;
  }
  if (truncated) {
    target.__operator_state_migration_truncated = true;
  }
}

function getOperatorState(context: OperatorContext): Record<string, unknown> {
  let legacyState: Record<string, unknown> | null = null;
  if (!isSafeStateContainer(context.state) || context.state === context.executionState) {
    legacyState = context.state;
    context.state = createOperatorState();
  }
  const existing = context.state[OPERATOR_STATE_KEY];
  const legacySnapshot = legacyState ? coerceLegacyState(legacyState) : null;
  if (isSafeStateContainer(existing)) {
    if (legacySnapshot && legacySnapshot !== context.executionState) {
      migrateOperatorState(existing, legacySnapshot, 'state_replaced');
    }
    return existing;
  }
  const next = createOperatorState();
  context.state[OPERATOR_STATE_KEY] = next;
  if (legacySnapshot && legacySnapshot !== context.executionState) {
    migrateOperatorState(next, legacySnapshot, 'state_replaced');
  }
  const existingSnapshot = existing ? coerceLegacyState(existing) : null;
  if (existingSnapshot) {
    migrateOperatorState(next, existingSnapshot, 'nested_state_replaced');
  }
  return next;
}

export class NoopOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType: TechniqueOperatorType;

  constructor(operatorType: TechniqueOperatorType) {
    this.operatorType = operatorType;
  }

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class SequenceOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'sequence';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    if (!Array.isArray(operatorState.sequenceInputs)) {
      operatorState.sequenceInputs = context.operator.inputs?.slice() ?? [];
      operatorState.sequenceIndex = 0;
    }
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    _result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const inputs = context.operator.inputs ?? [];
    if (inputs.length === 0) {
      return { type: 'continue', outputs: {} };
    }
    const operatorState = getOperatorState(context);
    const index = (operatorState.sequenceIndex as number | undefined) ?? 0;
    const expected = inputs[index];
    if (expected && primitive.id !== expected) {
      return {
        type: 'terminate',
        reason: `Sequence order violation: expected ${expected} but saw ${primitive.id}`,
        graceful: true,
      };
    }
    const position = index + 1;
    operatorState.sequenceIndex = position;
    const outputs: Record<string, unknown> = {
      sequencePosition: position,
      sequenceLength: inputs.length,
    };
    if (position >= inputs.length) {
      outputs.sequenceCompleted = true;
    }
    return { type: 'continue', outputs };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const inputs = context.operator.inputs ?? [];
    return {
      type: 'continue',
      outputs: {
        sequenceCompleted: true,
        sequenceLength: inputs.length,
        sequenceResults: results.length,
      },
    };
  }
}

type MergeSummary = {
  merged: Record<string, unknown>;
  collisions: string[];
  skipped: Array<{ key: string; primitiveId: string; reason: string }>;
  collisionOverflow: boolean;
  skippedOverflow: boolean;
  rejected?: { reason: string; detail: Record<string, unknown> };
};

function mergeResultOutputs(
  results: PrimitiveExecutionResult[],
  strategy: MergeStrategy
): MergeSummary {
  const merged: Record<string, unknown> = Object.create(null);
  const collisions: string[] = [];
  const skipped: Array<{ key: string; primitiveId: string; reason: string }> = [];
  let collisionOverflow = false;
  let skippedOverflow = false;

  for (const result of results) {
    if (!result.output || typeof result.output !== 'object' || result.output === null) continue;
    for (const [key, value] of Object.entries(result.output)) {
      const safeKey = sanitizeOutputKey(key);
      if (!safeKey) {
        if (skipped.length < MAX_MERGE_SKIPPED_KEYS) {
          skipped.push({ key, primitiveId: result.primitiveId, reason: 'invalid_key' });
        } else {
          skippedOverflow = true;
        }
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(merged, safeKey)) {
        merged[safeKey] = value;
        continue;
      }
      if (collisions.length < MAX_MERGE_COLLISIONS) {
        collisions.push(safeKey);
      } else {
        collisionOverflow = true;
      }
      if (strategy === 'reject') {
        return {
          merged,
          collisions,
          skipped,
          collisionOverflow,
          skippedOverflow,
          rejected: {
            reason: 'merge_collision',
            detail: { key: safeKey, primitiveId: result.primitiveId },
          },
        };
      }
      if (strategy === 'array') {
        const existing = merged[safeKey];
        if (!isMergeSafeValue(existing) || !isMergeSafeValue(value)) {
          return {
            merged,
            collisions,
            skipped,
            collisionOverflow,
            skippedOverflow,
            rejected: {
              reason: 'merge_unsafe_value',
              detail: { key: safeKey, primitiveId: result.primitiveId },
            },
          };
        }
        if (Array.isArray(existing)) {
          merged[safeKey] = [...existing, value];
        } else {
          merged[safeKey] = [existing, value];
        }
        continue;
      }
      if (strategy === 'last') {
        merged[safeKey] = value;
      }
    }
  }

  return { merged, collisions, skipped, collisionOverflow, skippedOverflow };
}

export class MergeOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'merge';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const strategy = normalizeMergeStrategy(context.operator);
    const summary = mergeResultOutputs(results, strategy);
    if (summary.rejected) {
      const state: Record<string, unknown> = Object.create(null);
      state.mergeStrategy = strategy;
      state.mergeReason = summary.rejected.reason;
      state.mergeDetail = summary.rejected.detail;
      state.mergePartial = sanitizeCheckpointRecord(summary.merged);
      state.mergeCollisions = summary.collisions;
      state.mergeSkippedKeys = summary.skipped;
      if (summary.collisionOverflow) state.mergeCollisionOverflow = true;
      if (summary.skippedOverflow) state.mergeSkippedOverflow = true;
      return {
        type: 'checkpoint',
        reason: 'Merge operator collision',
        state,
        terminate: true,
      };
    }
    const outputKey = resolveOperatorOutputKey(context.operator, 'merge');
    const outputs: Record<string, unknown> = Object.create(null);
    outputs[outputKey] = summary.merged;
    outputs.mergeStrategy = strategy;
    outputs.mergeCollisionCount = summary.collisions.length;
    if (summary.collisions.length > 0) outputs.mergeCollisions = summary.collisions;
    outputs.mergeSkippedCount = summary.skipped.length;
    if (summary.skipped.length > 0) outputs.mergeSkippedKeys = summary.skipped;
    if (summary.collisionOverflow) outputs.mergeCollisionOverflow = true;
    if (summary.skippedOverflow) outputs.mergeSkippedOverflow = true;
    return { type: 'continue', outputs };
  }
}

export class FanoutOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'fanout';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const inputs = context.operator.inputs ?? [];
    if (inputs[0] === primitive.id) {
      const operatorState = getOperatorState(context);
      operatorState.fanoutPayload = result.output;
    }
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const outputKey = resolveOperatorOutputKey(context.operator, 'fanout');
    const inputs = context.operator.inputs ?? [];
    const targets = context.operator.outputs ?? [];
    const payload = results[0]?.output ?? (getOperatorState(context).fanoutPayload ?? {});
    const outputs: Record<string, unknown> = Object.create(null);
    outputs[outputKey] = {
      source: inputs[0] ?? null,
      targets: targets.slice(),
      payload,
    };
    outputs.fanoutTargets = targets.slice();
    outputs.fanoutSource = inputs[0] ?? null;
    return { type: 'continue', outputs };
  }
}

export class FaninOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'fanin';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const outputKey = resolveOperatorOutputKey(context.operator, 'fanin');
    const sanitized = sanitizeCheckpointOutputs(
      results.map((result) => ({ primitiveId: result.primitiveId, output: result.output }))
    );
    const outputs: Record<string, unknown> = Object.create(null);
    outputs[outputKey] = sanitized.entries;
    outputs.faninCount = sanitized.entries.length;
    if (sanitized.truncated) {
      outputs.faninTruncated = true;
      outputs.faninTruncations = sanitized.truncations;
      outputs.faninCirculars = sanitized.circulars;
    }
    return { type: 'continue', outputs };
  }
}

export class ReduceOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'reduce';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const reducer = getStringParam(context.operator.parameters, ['reducer', 'aggregation', 'method']) ?? 'array';
    const field = getStringParam(context.operator.parameters, ['field', 'key', 'sourceKey']);
    const values: unknown[] = [];
    for (const result of results) {
      const output = result.output;
      if (!output || typeof output !== 'object' || Array.isArray(output)) {
        if (!field) values.push(output);
        continue;
      }
      if (field) {
        if (Object.prototype.hasOwnProperty.call(output, field)) {
          values.push((output as Record<string, unknown>)[field]);
        }
        continue;
      }
      const keys = Object.keys(output);
      if (keys.length === 1) {
        values.push((output as Record<string, unknown>)[keys[0] ?? '']);
      } else {
        values.push(output);
      }
    }

    let reduced: unknown;
    if (reducer === 'count') {
      reduced = values.length;
    } else if (reducer === 'sum' || reducer === 'average' || reducer === 'min' || reducer === 'max') {
      const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      if (numericValues.length === 0) {
        reduced = null;
      } else if (reducer === 'sum') {
        reduced = numericValues.reduce((sum, value) => sum + value, 0);
      } else if (reducer === 'average') {
        reduced = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
      } else if (reducer === 'min') {
        reduced = Math.min(...numericValues);
      } else {
        reduced = Math.max(...numericValues);
      }
    } else if (reducer === 'first') {
      reduced = values[0];
    } else if (reducer === 'last') {
      reduced = values[values.length - 1];
    } else if (reducer === 'merge') {
      const strategy = normalizeMergeStrategy(context.operator);
      const summary = mergeResultOutputs(results, strategy);
      if (summary.rejected) {
        return {
          type: 'checkpoint',
          reason: 'Reduce merge collision',
          state: {
            reduceStrategy: strategy,
            reduceReason: summary.rejected.reason,
            reduceDetail: summary.rejected.detail,
            reducePartial: sanitizeCheckpointRecord(summary.merged),
          },
          terminate: true,
        };
      }
      reduced = summary.merged;
    } else {
      reduced = values;
    }

    const outputKey = resolveOperatorOutputKey(context.operator, 'reduce');
    const outputs: Record<string, unknown> = Object.create(null);
    outputs[outputKey] = {
      reducer,
      field,
      value: reduced,
      count: values.length,
    };
    return { type: 'continue', outputs };
  }
}

export class ParallelOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'parallel';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const inputs = context.operator.inputs ?? [];
    if (inputs.length < 2) {
      return { type: 'continue', outputs: {} };
    }
    const state = getOperatorState(context);
    state.parallelGroup = inputs.slice();
    state.parallelResults = new Map<string, PrimitiveExecutionResult>();
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const state = getOperatorState(context);
    const results = state.parallelResults as Map<string, PrimitiveExecutionResult> | undefined;
    if (!results) return { type: 'continue', outputs: {} };
    results.set(primitive.id, result);

    const group = state.parallelGroup as string[] | undefined;
    if (!group || results.size < group.length) {
      return { type: 'continue', outputs: {} };
    }

    const failures = Array.from(results.values()).filter((entry) => entry.status === 'failed');
    if (failures.length > 0 && normalizeFailureMode(context.operator) === 'fail_fast') {
      return { type: 'terminate', reason: 'Parallel execution failed', graceful: true };
    }

    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const merged: Record<string, unknown> = Object.create(null);
    const rawOutputs = results.map((result) => ({
      primitiveId: result.primitiveId,
      output: result.output,
    }));
    const unprocessedOutputs: Array<{ primitiveId: string; output: unknown; reason: string }> = [];
    const collisions: Array<{ key: string; primitiveId: string }> = [];
    let collisionCount = 0;
    let collisionOverflow = false;
    const arrayCollisionKeys: string[] = [];
    const skippedKeys: Array<{ key: string; primitiveId: string; reason: string }> = [];
    let skippedCount = 0;
    let skippedOverflow = false;
    let overflowReason: string | null = null;
    type ParallelTermination = {
      detail: Record<string, unknown>;
      message: string;
      index: number;
      includeCurrent: boolean;
      reasonCode: string;
    };
    let termination: ParallelTermination | null = null;
    const collisionStrategy = getStringParam(context.operator.parameters, ['collisionStrategy', 'mergeStrategy']) ??
      'array';
    const seenKeys = new Map<string, string[]>();
    const recordCollision = (key: string, primitiveId: string): void => {
      collisionCount += 1;
      if (collisions.length < MAX_PARALLEL_COLLISIONS) {
        collisions.push({ key, primitiveId });
      } else {
        collisionOverflow = true;
        overflowReason = overflowReason ?? 'collision_overflow';
      }
    };
    const recordSkipped = (entry: { key: string; primitiveId: string; reason: string }): void => {
      skippedCount += 1;
      if (skippedKeys.length < MAX_PARALLEL_SKIPPED_KEYS) {
        skippedKeys.push(entry);
      } else {
        skippedOverflow = true;
        overflowReason = overflowReason ?? 'skipped_overflow';
      }
    };
    const attachParallelMetadata = (target: Record<string, unknown>, collisionDetail?: Record<string, unknown>) => {
      if (collisionCount > 0) {
        target.__parallel_collisions = collisions;
        target.__parallel_collision_count = collisionCount;
      }
      if (collisionOverflow) {
        target.__parallel_collision_overflow = true;
      }
      if (arrayCollisionKeys.length > 0) {
        target.__parallel_array_collisions = Array.from(new Set(arrayCollisionKeys));
      }
      if (skippedKeys.length > 0) {
        target.__parallel_skipped_keys = skippedKeys;
        target.__parallel_skipped_keys_count = skippedCount;
      }
      if (skippedOverflow) {
        target.__parallel_skipped_keys_overflow = true;
      }
      if (collisionDetail) {
        target.__parallel_collision_detected = collisionDetail;
      } else if (collisionCount > 0 || collisionOverflow) {
        target.__parallel_collision_detected = { detected: true, strategy: collisionStrategy };
      }
    };
    // Collision checkpoints include raw outputs and the outputs that could not be merged.
    const buildCollisionCheckpointState = (detail: Record<string, unknown>) => {
      const checkpointState: Record<string, unknown> = Object.create(null);
      const baseState = sanitizeCheckpointRecord(ensureOutputs(context.executionState));
      for (const [key, value] of Object.entries(baseState)) {
        checkpointState[key] = value;
      }
      const mergedSnapshot = sanitizeCheckpointRecord(merged);
      for (const [key, value] of Object.entries(mergedSnapshot)) {
        checkpointState[key] = value;
      }
      const sanitizedRaw = sanitizeCheckpointOutputs(rawOutputs);
      const sanitizedUnprocessed = sanitizeCheckpointOutputs(unprocessedOutputs);
      checkpointState.__parallel_raw_outputs = sanitizedRaw.entries;
      checkpointState.__parallel_raw_output_count = sanitizedRaw.entries.length;
      checkpointState.__parallel_expected_output_count = results.length;
      checkpointState.__parallel_unprocessed_outputs = sanitizedUnprocessed.entries;
      if (sanitizedRaw.truncated || sanitizedUnprocessed.truncated) {
        checkpointState.__parallel_checkpoint_truncated = true;
        checkpointState.__parallel_checkpoint_truncations = sanitizedRaw.truncations + sanitizedUnprocessed.truncations;
        checkpointState.__parallel_checkpoint_circulars = sanitizedRaw.circulars + sanitizedUnprocessed.circulars;
        console.warn('[parallel_operator] checkpoint outputs truncated due to size or cycles');
      }
      checkpointState.__parallel_partial_merge = mergedSnapshot;
      checkpointState.__parallel_collision_detail = detail;
      attachParallelMetadata(checkpointState, detail);
      return checkpointState;
    };
    const recordTermination = (
      detail: Record<string, unknown>,
      message: string,
      index: number,
      includeCurrent: boolean,
      reasonCode: string
    ): void => {
      if (termination) return;
      termination = { detail, message, index, includeCurrent, reasonCode };
    };
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result.output || typeof result.output !== 'object' || result.output === null) continue;
      for (const [key, value] of Object.entries(result.output)) {
        const safeKey = sanitizeOutputKey(key);
        if (!safeKey) {
          recordSkipped({ key, primitiveId: result.primitiveId, reason: 'invalid_key' });
          continue;
        }
        if (collisionStrategy === 'namespace') {
          if (result.primitiveId.includes('.')) {
            recordSkipped({ key: result.primitiveId, primitiveId: result.primitiveId, reason: 'invalid_primitive_id' });
            continue;
          }
          const safePrimitive = sanitizeOutputKey(result.primitiveId);
          if (!safePrimitive || safePrimitive !== result.primitiveId) {
            recordSkipped({ key: safeKey, primitiveId: result.primitiveId, reason: 'invalid_primitive' });
            continue;
          }
          const namespacedKey = `${safePrimitive}.${safeKey}`;
          if (namespacedKey.length > MAX_OUTPUT_KEY_LENGTH) {
            recordSkipped({ key: namespacedKey, primitiveId: result.primitiveId, reason: 'namespace_too_long' });
            continue;
          }
          if (namespacedKey.split('.').length > 2) {
            recordSkipped({ key: namespacedKey, primitiveId: result.primitiveId, reason: 'namespace_depth_exceeded' });
            continue;
          }
          if (!SAFE_NAMESPACE_PATTERN.test(namespacedKey)) {
            recordSkipped({ key: namespacedKey, primitiveId: result.primitiveId, reason: 'invalid_namespace' });
            continue;
          }
          const existing = seenKeys.get(safeKey) ?? [];
          if (existing.length > 0) {
            recordCollision(safeKey, result.primitiveId);
          }
          seenKeys.set(safeKey, [...existing, result.primitiveId]);
          merged[namespacedKey] = value;
        } else if (collisionStrategy === 'array') {
          if (!Object.prototype.hasOwnProperty.call(merged, safeKey)) {
            merged[safeKey] = value;
            continue;
          }
          recordCollision(safeKey, result.primitiveId);
          const existing = merged[safeKey];
          if (!isMergeSafeValue(existing) || !isMergeSafeValue(value)) {
            recordTermination(
              {
                detected: true,
                reason: 'collision_unsafe_merge',
                key: safeKey,
                primitiveId: result.primitiveId,
                strategy: collisionStrategy,
              },
              `Parallel output collision for key \"${safeKey}\"`,
              index,
              true,
              'collision_unsafe_merge'
            );
            break;
          }
          if (Array.isArray(existing)) {
            merged[safeKey] = [...existing, value];
          } else {
            arrayCollisionKeys.push(safeKey);
            merged[safeKey] = [existing, value];
          }
          continue;
        } else {
          if (!Object.prototype.hasOwnProperty.call(merged, safeKey)) {
            merged[safeKey] = value;
            continue;
          }
          recordCollision(safeKey, result.primitiveId);
          recordTermination(
            {
              detected: true,
              reason: 'collision_terminate',
              key: safeKey,
              primitiveId: result.primitiveId,
              strategy: collisionStrategy,
            },
            `Parallel output collision for key \"${safeKey}\"`,
            index,
            true,
            'collision_terminate'
          );
          break;
        }
      }
      if (termination) break;
      if (overflowReason) {
        recordTermination(
          {
            detected: true,
            reason: overflowReason,
            strategy: collisionStrategy,
          },
          'Parallel output metadata overflow',
          index,
          false,
          overflowReason
        );
        break;
      }
    }
    if (termination) {
      const terminationState = termination as ParallelTermination;
      const startIndex = terminationState.includeCurrent ? terminationState.index : terminationState.index + 1;
      for (let idx = startIndex; idx < results.length; idx += 1) {
        unprocessedOutputs.push({
          primitiveId: results[idx].primitiveId,
          output: results[idx].output,
          reason: terminationState.reasonCode,
        });
      }
      const checkpointState = buildCollisionCheckpointState(terminationState.detail);
      return {
        type: 'checkpoint',
        reason: terminationState.message,
        state: checkpointState,
        terminate: true,
      };
    }
    attachParallelMetadata(merged);
    return { type: 'continue', outputs: merged };
  }
}

export class ConditionalOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'conditional';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];
    const state = context.executionState;

    for (const [index, condition] of conditions.entries()) {
      const evaluation = evaluateOperatorCondition(condition, state);
      if (evaluation.matched) {
        const target = getConditionTarget(index, evaluation.target, context.operator);
        if (target) {
          return { type: 'branch', target };
        }
      }
    }

    const defaultTarget = getStringParam(context.operator.parameters, ['default', 'defaultTarget']);
    if (defaultTarget) {
      return { type: 'branch', target: defaultTarget };
    }

    return { type: 'skip', reason: 'No conditional branch matched' };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class LoopOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'loop';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const maxIterations =
      getNumberParam(context.operator.parameters, ['maxIterations', 'maxLoops'], { min: 1 }) ??
      MAX_LOOP_ITERATIONS;
    const state = getOperatorState(context);
    const iteration = (state.iteration as number | undefined) ?? 0;

    if (iteration >= maxIterations) {
      return {
        type: 'terminate',
        reason: `Loop exceeded maximum iterations (${maxIterations})`,
        graceful: true,
      };
    }

    state.iteration = iteration + 1;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];
    if (conditions.length === 0) {
      return { type: 'continue', outputs: { loopCompleted: true } };
    }

    for (const condition of conditions) {
      const evaluation = evaluateOperatorCondition(condition, context.executionState);
      if (evaluation.matched) {
        return { type: 'continue', outputs: { loopCompleted: true } };
      }
    }

    const fallbackTarget = context.operator.inputs?.[0];
    if (!fallbackTarget) {
      return { type: 'terminate', reason: 'Loop has no restart target', graceful: true };
    }
    if (!context.composition.primitiveIds.includes(fallbackTarget)) {
      return { type: 'terminate', reason: 'Loop restart target not found', graceful: true };
    }

    return { type: 'branch', target: fallbackTarget };
  }
}

export class RetryOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'retry';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const state = getOperatorState(context);
    if (result.status !== 'failed') {
      delete state[`retry_${primitive.id}`];
      return { type: 'continue', outputs: result.output };
    }

    const maxAttempts = getNumberParam(context.operator.parameters, ['maxAttempts'], { min: 1 });
    const maxRetries = getNumberParam(context.operator.parameters, ['maxRetries'], { min: 0 }) ?? DEFAULT_RETRY_MAX;
    const allowedRetries = maxAttempts ? Math.max(0, maxAttempts - 1) : maxRetries;
    const retryCount = (state[`retry_${primitive.id}`] as number | undefined ?? 0) + 1;
    state[`retry_${primitive.id}`] = retryCount;

    if (retryCount > allowedRetries) {
      return {
        type: 'terminate',
        reason: `Primitive ${primitive.id} failed after ${allowedRetries} retries`,
        graceful: true,
      };
    }

    const backoff = getStringParam(context.operator.parameters, ['backoff', 'strategy']) ?? 'exponential';
    const baseDelay =
      getNumberParam(context.operator.parameters, ['baseDelayMs', 'retryDelayMs'], { min: 0 }) ??
      DEFAULT_RETRY_DELAY_MS;
    const jitter = getNumberParam(context.operator.parameters, ['jitterMs'], { min: 0 }) ?? 0;
    const delay = calculateBackoffDelay(backoff, baseDelay, retryCount, jitter);

    return { type: 'retry', delay, attempt: retryCount };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class BackoffOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'backoff';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status !== 'failed') {
      const operatorState = getOperatorState(context);
      delete operatorState[`backoff_${primitive.id}`];
      return { type: 'continue', outputs: {} };
    }

    const operatorState = getOperatorState(context);
    const maxAttempts =
      getNumberParam(context.operator.parameters, ['maxAttempts', 'maxRetries', 'maxBackoffAttempts'], { min: 1 }) ??
      DEFAULT_RETRY_MAX;
    const attempt = (operatorState[`backoff_${primitive.id}`] as number | undefined ?? 0) + 1;
    operatorState[`backoff_${primitive.id}`] = attempt;
    if (attempt > maxAttempts) {
      return {
        type: 'terminate',
        reason: `Backoff exceeded maximum attempts (${maxAttempts})`,
        graceful: true,
      };
    }

    const baseDelay =
      getNumberParam(context.operator.parameters, ['baseDelayMs', 'delayMs'], { min: 0 }) ?? DEFAULT_RETRY_DELAY_MS;
    const multiplier =
      getNumberParam(context.operator.parameters, ['multiplier', 'backoffMultiplier'], { min: 0.1 }) ?? 2;
    const maxDelay =
      getNumberParam(context.operator.parameters, ['maxDelayMs'], { min: 0 }) ?? MAX_BACKOFF_DELAY_MS;

    const safeAttempt = Math.max(1, Math.min(attempt, 50));
    let delay = baseDelay * Math.pow(multiplier, safeAttempt - 1);
    if (!Number.isFinite(delay)) delay = MAX_BACKOFF_DELAY_MS;
    delay = Math.max(0, Math.min(delay, MAX_BACKOFF_DELAY_MS, maxDelay));
    return { type: 'retry', delay, attempt };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

function calculateBackoffDelay(strategy: string, baseDelay: number, attempt: number, jitter: number): number {
  const normalizedBase = Number.isFinite(baseDelay) ? Math.max(0, baseDelay) : 0;
  const safeAttempt = Math.max(1, Math.min(attempt, 50));
  const safeExponent = Math.min(safeAttempt - 1, 20);
  let delay = normalizedBase;
  const safeRandomInt = (maxValue: number): number => {
    if (!Number.isFinite(maxValue) || maxValue <= 0) return 0;
    const upper = Math.min(Math.floor(maxValue), MAX_BACKOFF_DELAY_MS);
    if (upper <= 0) return 0;
    try {
      return randomInt(0, upper + 1);
    } catch {
      return Math.min(100, upper);
    }
  };
  switch (strategy) {
    case 'constant':
      delay = normalizedBase;
      break;
    case 'linear':
      delay = normalizedBase * safeAttempt;
      if (!Number.isFinite(delay)) return MAX_BACKOFF_DELAY_MS;
      break;
    case 'exponential':
      delay = normalizedBase * Math.pow(2, safeExponent);
      if (!Number.isFinite(delay)) return MAX_BACKOFF_DELAY_MS;
      break;
    case 'exponential_jitter': {
      const exp = normalizedBase * Math.pow(2, safeExponent);
      if (!Number.isFinite(exp)) {
        return MAX_BACKOFF_DELAY_MS;
      }
      const jitterMax = exp > 0
        ? Math.max(1, Math.min(Math.ceil(exp * 0.3), MAX_BACKOFF_DELAY_MS))
        : 0;
      delay = jitterMax > 0 ? exp + safeRandomInt(jitterMax) : exp;
      break;
    }
    default:
      delay = normalizedBase;
  }
  const safeJitter = Number.isFinite(jitter) ? Math.max(0, Math.min(jitter, MAX_BACKOFF_DELAY_MS)) : 0;
  if (safeJitter > 0) {
    const jitterMax = Math.max(1, Math.min(Math.ceil(safeJitter), MAX_BACKOFF_DELAY_MS));
    delay += safeRandomInt(jitterMax);
  }
  if (!Number.isFinite(delay)) {
    return MAX_BACKOFF_DELAY_MS;
  }
  return Math.min(Math.max(delay, 0), MAX_BACKOFF_DELAY_MS);
}

export class CircuitBreakerOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'circuit_breaker';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const resetTimeout =
      getNumberParam(context.operator.parameters, ['resetTimeoutMs', 'cooldownMs'], { min: 0 }) ??
      DEFAULT_CIRCUIT_RESET_MS;
    const operatorState = getOperatorState(context);
    const state = (operatorState.circuitState as {
      status: 'closed' | 'open' | 'half-open';
      failures: number;
      lastFailure: number | null;
    } | undefined) ?? {
      status: 'closed',
      failures: 0,
      lastFailure: null,
    };

    if (state.status === 'open') {
      const lastFailure = state.lastFailure ?? 0;
      const timeSinceLastFailure = Date.now() - lastFailure;
      if (timeSinceLastFailure < resetTimeout) {
        return {
          type: 'skip',
          reason: `Circuit breaker open (${Math.ceil((resetTimeout - timeSinceLastFailure) / 1000)}s remaining)`,
        };
      }
      state.status = 'half-open';
    }

    operatorState.circuitState = state;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    const state = operatorState.circuitState as {
      status: 'closed' | 'open' | 'half-open';
      failures: number;
      lastFailure: number | null;
    } | undefined;
    if (!state) return { type: 'continue', outputs: {} };

    const threshold =
      getNumberParam(context.operator.parameters, ['failureThreshold', 'errorThreshold'], { min: 1 }) ??
      DEFAULT_CIRCUIT_THRESHOLD;

    if (result.status === 'failed') {
      state.failures += 1;
      state.lastFailure = Date.now();
      if (state.status === 'half-open' || state.failures >= threshold) {
        state.status = 'open';
        return {
          type: 'terminate',
          reason: 'Circuit breaker open - failure threshold reached',
          graceful: true,
        };
      }
    } else if (state.status === 'half-open') {
      state.status = 'closed';
      state.failures = 0;
    }

    return { type: 'continue', outputs: result.output };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class FallbackOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'fallback';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status !== 'failed') {
      return { type: 'continue', outputs: result.output };
    }

    const fallbackTargets = context.operator.outputs ?? [];
    const operatorState = getOperatorState(context);
    const attempted = operatorState.attemptedFallbacks as Set<string> | undefined ?? new Set();

    for (const fallbackId of fallbackTargets) {
      if (!attempted.has(fallbackId)) {
        attempted.add(fallbackId);
        operatorState.attemptedFallbacks = attempted;
        return { type: 'branch', target: fallbackId };
      }
    }

    return { type: 'terminate', reason: 'All fallback paths exhausted', graceful: true };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class QuorumOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'quorum';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const eligibleResults = results.filter((result) => result.status !== 'failed');
    if (eligibleResults.length === 0) {
      return {
        type: 'escalate',
        level: 'human',
        context: {
          reason: 'No eligible results',
          votes: 0,
          required: 0,
          eligible: 0,
          failed: results.length,
        },
      };
    }
    const defaultRequired = Math.floor(eligibleResults.length / 2) + 1;
    const required =
      getNumberParam(context.operator.parameters, ['required', 'quorumSize'], { min: 1 }) ??
      defaultRequired;
    if (required > eligibleResults.length) {
      return {
        type: 'escalate',
        level: 'human',
        context: {
          reason: 'Quorum not reachable',
          votes: 0,
          required,
          eligible: eligibleResults.length,
          failed: results.length - eligibleResults.length,
        },
      };
    }

    const conclusionMap = new Map<string, { count: number; value: unknown }>();
    const resultKeys = new Map<string, string>();
    for (const [index, result] of eligibleResults.entries()) {
      const { key, value } = serializeConclusion(result.output?.['conclusion'] ?? result.output, index);
      resultKeys.set(result.primitiveId, key);
      const existing = conclusionMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        conclusionMap.set(key, { count: 1, value });
      }
    }

    let maxVotes = 0;
    let majorityKey: string | null = null;
    for (const [key, summary] of conclusionMap) {
      if (summary.count > maxVotes) {
        maxVotes = summary.count;
        majorityKey = key;
      }
    }

    if (maxVotes >= required) {
      if (majorityKey === UNSERIALIZABLE_CONCLUSION_KEY) {
        return {
          type: 'escalate',
          level: 'human',
          context: {
            reason: 'Quorum not reachable: unserializable conclusions',
            votes: maxVotes,
            required,
            eligible: eligibleResults.length,
            failed: results.length - eligibleResults.length,
          },
        };
      }
      const majority = majorityKey ? conclusionMap.get(majorityKey) ?? null : null;
      return {
        type: 'continue',
        outputs: {
          quorumReached: true,
          conclusion: majority?.value ?? null,
          votes: maxVotes,
          required,
          dissent: eligibleResults.filter((result) => resultKeys.get(result.primitiveId) !== majorityKey)
            .map((result) => ({ primitiveId: result.primitiveId, output: result.output })),
          failed: results.filter((result) => result.status === 'failed')
            .map((result) => ({ primitiveId: result.primitiveId, output: result.output })),
        },
      };
    }

    return {
      type: 'escalate',
      level: 'human',
      context: {
        reason: required > eligibleResults.length ? 'Quorum not reachable' : 'Quorum not reached',
        votes: maxVotes,
        required,
        eligible: eligibleResults.length,
        failed: results.length - eligibleResults.length,
      },
    };
  }
}

export class ConsensusOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'consensus';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const successResults = results.filter((result) => result.status !== 'failed');
    if (successResults.length === 0) {
      return { type: 'terminate', reason: 'No successful results for consensus', graceful: true };
    }

    const serialized = successResults.map((result, index) =>
      serializeConclusion(result.output?.['conclusion'] ?? result.output, index)
    );
    const uniqueConclusions = new Set(serialized.map((entry) => entry.key));

    if (uniqueConclusions.size === 1) {
      const onlyKey = serialized[0]?.key ?? UNSERIALIZABLE_CONCLUSION_KEY;
      if (onlyKey === UNSERIALIZABLE_CONCLUSION_KEY) {
        return {
          type: 'escalate',
          level: 'human',
          context: {
            reason: 'Consensus not reachable: unserializable conclusions',
            positions: successResults.map((result) => ({ primitiveId: result.primitiveId, conclusion: result.output })),
          },
        };
      }
      return {
        type: 'continue',
        outputs: {
          consensusReached: true,
          unanimous: true,
          conclusion: serialized[0]?.value ?? null,
        },
      };
    }

    const resolution = getStringParam(context.operator.parameters, ['resolution', 'consensusRule']) ?? 'escalate';
    if (resolution === 'majority') {
      const votes = new Map<string, { count: number; value: unknown }>();
      for (const entry of serialized) {
        const existing = votes.get(entry.key);
        if (existing) {
          existing.count += 1;
        } else {
          votes.set(entry.key, { count: 1, value: entry.value });
        }
      }
      let maxKey = serialized[0]?.key ?? 'null';
      let maxVotes = 0;
      for (const [key, summary] of votes) {
        if (summary.count > maxVotes) {
          maxKey = key;
          maxVotes = summary.count;
        }
      }
      const majority = votes.get(maxKey);
      return {
        type: 'continue',
        outputs: {
          consensusReached: true,
          unanimous: false,
          method: 'majority',
          conclusion: majority?.value ?? null,
        },
      };
    }

    return {
      type: 'escalate',
      level: 'human',
      context: {
        reason: 'Consensus not reached',
        positions: successResults.map((result) => ({ primitiveId: result.primitiveId, conclusion: result.output })),
      },
    };
  }
}

export class TimeboxOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'timebox';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const timeoutMs =
      getNumberParam(context.operator.parameters, ['timeoutMs', 'limitMs'], { min: 1 }) ??
      DEFAULT_TIMEBOX_MS;
    const deadlineIso = getStringParam(context.operator.parameters, ['deadlineIso', 'deadline']);
    let deadline = Date.now() + timeoutMs;
    if (deadlineIso) {
      const parsed = Date.parse(deadlineIso);
      if (Number.isNaN(parsed)) {
        return { type: 'terminate', reason: 'Invalid timebox deadline', graceful: true };
      }
      deadline = parsed;
    }
    const operatorState = getOperatorState(context);
    operatorState.timeboxStart = Date.now();
    operatorState.timeboxDeadline = deadline;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    _result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    const deadline = operatorState.timeboxDeadline as number | undefined;
    if (deadline && Date.now() > deadline) {
      const action = getStringParam(context.operator.parameters, ['onTimeout']) ?? 'checkpoint';
      if (action === 'terminate') {
        return { type: 'terminate', reason: 'Timebox exceeded', graceful: true };
      }
      return { type: 'checkpoint', reason: 'Timebox exceeded', state: ensureOutputs(context.executionState) };
    }
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    const startedAt = operatorState.timeboxStart as number | undefined;
    const elapsedMs = startedAt ? Date.now() - startedAt : 0;
    return { type: 'continue', outputs: { elapsedMs } };
  }
}

export class BudgetCapOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'budget_cap';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const maxTokens = getNumberParam(context.operator.parameters, ['maxTokens', 'budgetLimit'], { min: 1 }) ??
      100000;
    const operatorState = getOperatorState(context);
    operatorState.budgetMaxTokens = maxTokens;
    operatorState.budgetUsedTokens = 0;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    const llmEvidence = result.evidence.filter((entry) => entry.type === 'llm');
    for (const entry of llmEvidence) {
      const rawTokens = entry.metadata?.['tokens'];
      const tokens = typeof rawTokens === 'number' && Number.isFinite(rawTokens) && rawTokens >= 0 ? rawTokens : 0;
      const used = (operatorState.budgetUsedTokens as number | undefined) ?? 0;
      operatorState.budgetUsedTokens = used + tokens;
    }

    const used = operatorState.budgetUsedTokens as number;
    const max = operatorState.budgetMaxTokens as number;
    if (used > max) {
      return { type: 'terminate', reason: `Budget exceeded: ${used}/${max} tokens`, graceful: true };
    }

    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    return { type: 'continue', outputs: { totalTokens: operatorState.budgetUsedTokens } };
  }
}

export class GateOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'gate';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];
    if (conditions.length === 0) {
      return { type: 'continue', outputs: {} };
    }

    for (const condition of conditions) {
      const evaluation = evaluateOperatorCondition(condition, context.executionState);
      if (evaluation.matched) {
        const action = getStringParam(context.operator.parameters, ['onFail', 'action']) ?? 'terminate';
        if (action === 'checkpoint') {
          return { type: 'checkpoint', reason: 'Gate condition triggered', state: ensureOutputs(context.executionState) };
        }
        return { type: 'terminate', reason: 'Gate condition triggered', graceful: true };
      }
    }

    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class CheckpointOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'checkpoint';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const reason = getStringParam(context.operator.parameters, ['reason']) ?? 'Checkpoint reached';
    return { type: 'checkpoint', reason, state: ensureOutputs(context.executionState) };
  }
}

export class InterruptOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'interrupt';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];
    if (conditions.length === 0) {
      return { type: 'terminate', reason: 'Interrupt triggered', graceful: true };
    }

    for (const condition of conditions) {
      const evaluation = evaluateOperatorCondition(condition, context.executionState);
      if (evaluation.matched) {
        return { type: 'terminate', reason: 'Interrupt triggered', graceful: true };
      }
    }

    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class EscalateOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'escalate';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const level = getStringParam(context.operator.parameters, ['level']) as EscalationLevel | undefined;
    return {
      type: 'escalate',
      level: level ?? 'human',
      context: {
        reason: 'Escalation required',
        operatorId: context.operator.id,
      },
    };
  }
}

export class TimeboxedThrottleOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'throttle';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const maxRate = getNumberParam(context.operator.parameters, ['maxRate'], { min: 1 });
    if (!maxRate || maxRate <= 0) {
      return { type: 'continue', outputs: {} };
    }
    const windowMs = getNumberParam(context.operator.parameters, ['rateWindowMs'], { min: 1 }) ?? 1000;
    const now = Date.now();
    const operatorState = getOperatorState(context);
    const timestamps = operatorState.throttleTimestamps as number[] | undefined ?? [];
    const filtered = timestamps.filter((stamp) => now - stamp <= windowMs);
    filtered.push(now);
    operatorState.throttleTimestamps = filtered;
    if (filtered.length > maxRate) {
      const earliest = filtered[0] ?? now;
      const delay = Math.max(0, windowMs - (now - earliest));
      return { type: 'retry', delay, attempt: filtered.length };
    }
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}

export class PersistOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'persist';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    return { type: 'checkpoint', reason: 'Persist operator reached', state: ensureOutputs(context.executionState) };
  }
}

export class MonitorOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'monitor';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const signals = context.operator.parameters?.['signals'];
    const counts = results.reduce(
      (acc, result) => {
        acc.total += 1;
        if (result.status === 'failed') acc.failed += 1;
        else acc.succeeded += 1;
        acc.durationMs += result.durationMs ?? 0;
        return acc;
      },
      { total: 0, failed: 0, succeeded: 0, durationMs: 0 }
    );
    const outputKey = resolveOperatorOutputKey(context.operator, 'monitor');
    const outputs: Record<string, unknown> = Object.create(null);
    outputs[outputKey] = {
      signals,
      totals: counts,
      failures: results.filter((result) => result.status === 'failed')
        .map((result) => ({ primitiveId: result.primitiveId, issues: result.issues })),
    };
    outputs.monitorSummary = counts;
    return { type: 'continue', outputs };
  }
}

export class ReplayOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'replay';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const replayId = getStringParam(context.operator.parameters, ['replayId', 'id']);
    const state = context.operator.parameters?.['state'];
    const outputs: Record<string, unknown> = Object.create(null);
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const sanitized = sanitizeCheckpointRecord(state as Record<string, unknown>);
      outputs.replayState = sanitized;
      mergeIntoState(context.executionState, sanitized);
    }
    if (replayId) outputs.replayId = replayId;
    outputs.replayStarted = true;
    return { type: 'continue', outputs };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const outputKey = resolveOperatorOutputKey(context.operator, 'replay');
    const sanitized = sanitizeCheckpointOutputs(
      results.map((result) => ({ primitiveId: result.primitiveId, output: result.output }))
    );
    const outputs: Record<string, unknown> = Object.create(null);
    outputs[outputKey] = sanitized.entries;
    outputs.replayCompleted = true;
    return { type: 'continue', outputs };
  }
}

export class CacheOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'cache';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    const cacheKey = resolveOperatorOutputKey(context.operator, 'cache');
    const entries = operatorState.cacheEntries as Record<string, unknown> | undefined;
    const cached = entries && Object.prototype.hasOwnProperty.call(entries, cacheKey) ? entries[cacheKey] : undefined;
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      mergeIntoState(context.executionState, cached as Record<string, unknown>);
      return { type: 'continue', outputs: { cacheHit: true, cacheKey } };
    }
    return { type: 'continue', outputs: { cacheHit: false, cacheKey } };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status === 'failed') return { type: 'continue', outputs: {} };
    const operatorState = getOperatorState(context);
    const cacheKey = resolveOperatorOutputKey(context.operator, 'cache');
    let entries = operatorState.cacheEntries as Record<string, unknown> | undefined;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      entries = Object.create(null) as Record<string, unknown>;
      operatorState.cacheEntries = entries;
    }
    entries![cacheKey] = sanitizeCheckpointRecord(ensureOutputs(result.output));
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const operatorState = getOperatorState(context);
    const entries = operatorState.cacheEntries as Record<string, unknown> | undefined;
    const count = entries ? Object.keys(entries).length : 0;
    return { type: 'continue', outputs: { cacheEntries: count } };
  }
}

const UNSERIALIZABLE_CONCLUSION_KEY = '__unserializable__';

function serializeConclusion(value: unknown, _index: number): { key: string; value: unknown } {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') {
      return { key: UNSERIALIZABLE_CONCLUSION_KEY, value };
    }
    return { key: text, value };
  } catch {
    return { key: UNSERIALIZABLE_CONCLUSION_KEY, value };
  }
}

export const __testing = {
  calculateBackoffDelay,
  parseConditionExpression,
  tokenizeCondition,
  MAX_CONDITION_ERRORS,
};

export const DEFAULT_OPERATOR_INTERPRETERS: OperatorInterpreter[] = [
  new SequenceOperatorInterpreter(),
  new ParallelOperatorInterpreter(),
  new ConditionalOperatorInterpreter(),
  new LoopOperatorInterpreter(),
  new GateOperatorInterpreter(),
  new FallbackOperatorInterpreter(),
  new MergeOperatorInterpreter(),
  new FanoutOperatorInterpreter(),
  new FaninOperatorInterpreter(),
  new RetryOperatorInterpreter(),
  new EscalateOperatorInterpreter(),
  new CheckpointOperatorInterpreter(),
  new InterruptOperatorInterpreter(),
  new TimeboxOperatorInterpreter(),
  new BudgetCapOperatorInterpreter(),
  new TimeboxedThrottleOperatorInterpreter(),
  new QuorumOperatorInterpreter(),
  new ConsensusOperatorInterpreter(),
  new BackoffOperatorInterpreter(),
  new CircuitBreakerOperatorInterpreter(),
  new MonitorOperatorInterpreter(),
  new PersistOperatorInterpreter(),
  new ReplayOperatorInterpreter(),
  new CacheOperatorInterpreter(),
  new ReduceOperatorInterpreter(),
];
