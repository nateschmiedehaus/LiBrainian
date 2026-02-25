import * as fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { FunctionId } from '../../core/function_range_mapper.js';
import type { FunctionKnowledge } from '../../types.js';
import type { GraphEdge, GraphEdgeQueryOptions, LibrarianStorage } from '../../storage/types.js';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction, type Context } from '../types.js';

export type ComplexityClass =
  | 'O(1)'
  | 'O(log n)'
  | 'O(n)'
  | 'O(n log n)'
  | 'O(n^2)'
  | 'O(n^3)'
  | 'exponential'
  | 'unknown';

export interface PerformanceSensorInput {
  targets: FunctionId[];
  diff?: string;
  inputSizeHints?: Record<string, number>;
  hotPathsOnly?: boolean;
}

export interface ComplexityAnalysis {
  functionId: FunctionId;
  filePath: string;
  functionName: string;
  currentComplexity: ComplexityClass;
  previousComplexity?: ComplexityClass;
  isHotPath: boolean;
  typicalInputSize?: number;
  estimatedImpact?: string;
  regressionPattern?: string;
  severity: 'critical' | 'warning' | 'info';
  confidence: number;
}

export interface PerformanceSensorOutput {
  analyses: ComplexityAnalysis[];
  regressions: ComplexityAnalysis[];
  hotPathRegressions: ComplexityAnalysis[];
  agentSummary: string;
}

type StorageSlice = Pick<LibrarianStorage, 'getFunctions' | 'getGraphEdges'>;

interface ComplexityEstimate {
  complexity: ComplexityClass;
  confidence: number;
  reason: string;
}

interface FunctionContext {
  fn: FunctionKnowledge;
  filePath: string;
  functionName: string;
}

const COMPLEXITY_RANK: Record<ComplexityClass, number> = {
  'O(1)': 0,
  'O(log n)': 1,
  'O(n)': 2,
  'O(n log n)': 3,
  'O(n^2)': 4,
  'O(n^3)': 5,
  exponential: 6,
  unknown: -1,
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function toStorageSlice(value: unknown): StorageSlice | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.getFunctions !== 'function') return null;
  if (typeof record.getGraphEdges !== 'function') return null;
  return value as StorageSlice;
}

async function resolveStorage(context?: Context<unknown>): Promise<StorageSlice | null> {
  const deps = context?.deps as Record<string, unknown> | undefined;
  const librarian = deps?.librarian as { getStorage?: () => unknown } | undefined;
  if (!librarian || typeof librarian.getStorage !== 'function') return null;
  const storage = await Promise.resolve(librarian.getStorage());
  return toStorageSlice(storage);
}

function resolveWorkspaceRoot(context: Context<unknown> | undefined, filePath: string): string {
  const deps = context?.deps as Record<string, unknown> | undefined;
  const librarian = deps?.librarian as { workspaceRoot?: unknown; rootDir?: unknown } | undefined;
  const workspaceRoot = typeof librarian?.workspaceRoot === 'string' ? librarian.workspaceRoot
    : typeof librarian?.rootDir === 'string' ? librarian.rootDir
    : process.cwd();
  if (path.isAbsolute(filePath)) {
    return path.dirname(filePath);
  }
  return workspaceRoot;
}

function parseFunctionNameFromId(functionId: string): string {
  const hashIndex = functionId.lastIndexOf('#');
  if (hashIndex !== -1 && hashIndex < functionId.length - 1) {
    return functionId.slice(hashIndex + 1);
  }
  const colonIndex = functionId.lastIndexOf(':');
  if (colonIndex !== -1 && colonIndex < functionId.length - 1) {
    return functionId.slice(colonIndex + 1);
  }
  return functionId;
}

function declarationName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
    return null;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return null;
}

function findFunctionNode(sourceFile: ts.SourceFile, functionName: string): ts.Node | null {
  let match: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (match) return;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) {
      if (declarationName(node) === functionName) {
        match = node;
        return;
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === functionName) {
      if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        match = node.initializer;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function isSmallConstantBoundLoop(node: ts.IterationStatement): boolean {
  if (ts.isForStatement(node)) {
    const condition = node.condition;
    if (!condition || !ts.isBinaryExpression(condition)) return false;
    const right = condition.right;
    if (ts.isNumericLiteral(right)) {
      const bound = Number(right.text);
      return Number.isFinite(bound) && bound > 0 && bound <= 16;
    }
    return false;
  }

  if (ts.isForOfStatement(node)) {
    const expression = unwrapExpression(node.expression);
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.length <= 16;
    }
    if (ts.isIdentifier(expression)) {
      return /(days|weekday|weekdays|months|hours)/iu.test(expression.text);
    }
    return false;
  }

  return false;
}

function collectLoopFeatures(
  functionNode: ts.Node,
  functionName: string,
): {
  maxDepth: number;
  hasLoops: boolean;
  boundedLoopsOnly: boolean;
  hasSortCall: boolean;
  hasBinarySearchCall: boolean;
  hasFindInLoop: boolean;
  recursiveCalls: number;
} {
  let maxDepth = 0;
  let hasLoops = false;
  let boundedLoopsOnly = true;
  let hasSortCall = false;
  let hasBinarySearchCall = false;
  let hasFindInLoop = false;
  let recursiveCalls = 0;

  const visit = (node: ts.Node, loopDepth: number): void => {
    if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(node.expression);
      if (ts.isIdentifier(expression) && expression.text === functionName) {
        recursiveCalls += 1;
      }
      if (ts.isIdentifier(expression) && /binarysearch/iu.test(expression.text)) {
        hasBinarySearchCall = true;
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const methodName = expression.name.text;
        if (methodName === 'sort') hasSortCall = true;
        if (/(find|filter|some|every)/iu.test(methodName) && loopDepth > 0) {
          hasFindInLoop = true;
        }
      }
    }

    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      hasLoops = true;
      const bounded = isSmallConstantBoundLoop(node);
      if (!bounded) boundedLoopsOnly = false;
      const nextDepth = loopDepth + 1;
      maxDepth = Math.max(maxDepth, nextDepth);
      ts.forEachChild(node, (child) => visit(child, nextDepth));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, loopDepth));
  };

  visit(functionNode, 0);
  return {
    maxDepth,
    hasLoops,
    boundedLoopsOnly,
    hasSortCall,
    hasBinarySearchCall,
    hasFindInLoop,
    recursiveCalls,
  };
}

function estimateComplexityFromFeatures(
  features: ReturnType<typeof collectLoopFeatures>,
): ComplexityEstimate {
  if (features.recursiveCalls >= 2) {
    return { complexity: 'exponential', confidence: 0.85, reason: 'multiple recursive calls in function body' };
  }

  if (features.maxDepth >= 3) {
    if (features.boundedLoopsOnly) {
      return { complexity: 'O(1)', confidence: 0.8, reason: 'nested loops are constant-bounded' };
    }
    return { complexity: 'O(n^3)', confidence: 0.9, reason: 'triple nested loops over unbounded collections' };
  }

  if (features.maxDepth === 2) {
    if (features.boundedLoopsOnly) {
      return { complexity: 'O(1)', confidence: 0.8, reason: 'nested loops are constant-bounded' };
    }
    return { complexity: 'O(n^2)', confidence: 0.9, reason: 'nested loops over unbounded collections' };
  }

  if (features.maxDepth === 1) {
    if (features.hasFindInLoop) {
      return { complexity: 'O(n^2)', confidence: 0.9, reason: 'linear scan call inside loop body' };
    }
    if (features.hasSortCall) {
      return { complexity: 'O(n log n)', confidence: 0.85, reason: 'single pass plus sort operation' };
    }
    if (features.hasBinarySearchCall) {
      return { complexity: 'O(log n)', confidence: 0.85, reason: 'binary search call in loop context' };
    }
    return { complexity: 'O(n)', confidence: 0.85, reason: 'single unbounded loop' };
  }

  if (features.hasSortCall) {
    return { complexity: 'O(n log n)', confidence: 0.8, reason: 'sort operation with no explicit loop nest' };
  }

  if (features.hasBinarySearchCall) {
    return { complexity: 'O(log n)', confidence: 0.85, reason: 'binary search call detected' };
  }

  return { complexity: 'O(1)', confidence: 0.8, reason: 'no unbounded iteration detected' };
}

function estimateComplexityFromSemantics(fn: FunctionKnowledge): ComplexityEstimate {
  const text = `${fn.purpose ?? ''} ${fn.signature ?? ''}`.toLowerCase();
  if (/(nested loop|for each .* for each)/iu.test(text)) {
    return { complexity: 'O(n^2)', confidence: 0.6, reason: 'inferred from semantic description of nested iteration' };
  }
  if (/binarysearch|binary search/iu.test(text)) {
    return { complexity: 'O(log n)', confidence: 0.6, reason: 'inferred from semantic mention of binary search' };
  }
  if (/sort/iu.test(text)) {
    return { complexity: 'O(n log n)', confidence: 0.6, reason: 'inferred from semantic mention of sorting' };
  }
  if (/(iterate|scan|loop|for each)/iu.test(text)) {
    return { complexity: 'O(n)', confidence: 0.6, reason: 'inferred from semantic mention of linear iteration' };
  }
  return { complexity: 'unknown', confidence: 0.4, reason: 'insufficient implementation signal to classify complexity' };
}

function analyzeComplexityFromCode(code: string, functionName: string): ComplexityEstimate {
  const sourceFile = ts.createSourceFile('analysis.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functionNode = findFunctionNode(sourceFile, functionName);
  if (!functionNode) {
    return { complexity: 'unknown', confidence: 0.4, reason: 'target function implementation not found in source' };
  }
  const features = collectLoopFeatures(functionNode, functionName);
  return estimateComplexityFromFeatures(features);
}

function complexityFromDiff(diff: string | undefined, filePath: string, functionName: string): ComplexityEstimate | undefined {
  if (!diff) return undefined;
  const normalizedTarget = normalizePath(filePath);
  const lines = diff.split('\n');
  let currentFile: string | null = null;
  const removed: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const candidate = line.slice(4).trim().replace(/^b\//u, '');
      currentFile = normalizePath(candidate);
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (!currentFile) continue;
    if (currentFile !== normalizedTarget && !normalizedTarget.endsWith(currentFile) && !currentFile.endsWith(normalizedTarget)) {
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      removed.push(line.slice(1));
    }
  }
  if (removed.length === 0) return undefined;
  const snippet = removed.join('\n');
  const wrapped = `function ${functionName}() {\n${snippet}\n}`;
  const estimate = analyzeComplexityFromCode(wrapped, functionName);
  if (estimate.complexity === 'unknown') return undefined;
  return estimate;
}

function inferTypicalInputSize(
  fn: FunctionKnowledge,
  isHotPath: boolean,
  hints: Record<string, number> | undefined,
): number | undefined {
  if (hints) {
    for (const [key, value] of Object.entries(hints)) {
      if (value <= 0) continue;
      if (fn.signature.includes(key) || (fn.purpose?.includes(key) ?? false)) {
        return value;
      }
    }
  }
  if (!isHotPath) return undefined;
  const signature = fn.signature.toLowerCase();
  if (!signature.includes('[]')) return undefined;
  if (/product|catalog/iu.test(signature)) return 50_000;
  if (/user/iu.test(signature)) return 10_000;
  return 5_000;
}

function estimateOperations(complexity: ComplexityClass, size: number): number | undefined {
  if (size <= 0) return undefined;
  if (complexity === 'O(n)') return size;
  if (complexity === 'O(n log n)') return Math.round(size * Math.log2(Math.max(2, size)));
  if (complexity === 'O(n^2)') return size * size;
  if (complexity === 'O(n^3)') return size * size * size;
  return undefined;
}

function formatImpact(complexity: ComplexityClass, size: number): string | undefined {
  const operations = estimateOperations(complexity, size);
  if (!operations) return undefined;
  return `${complexity} on ${size.toLocaleString('en-US')} items -> ~${operations.toLocaleString('en-US')} operations per call`;
}

function isRequestPathLike(value: string): boolean {
  return /(handler|controller|route|endpoint|render|listener)/iu.test(value);
}

async function detectHotPath(
  storage: StorageSlice,
  functionsById: Map<string, FunctionKnowledge>,
  functionId: string,
  fn: FunctionKnowledge,
): Promise<boolean> {
  const query: GraphEdgeQueryOptions = {
    edgeTypes: ['calls'],
    toIds: [functionId],
    limit: 2_000,
  };
  const edges = await storage.getGraphEdges(query);
  if (edges.length >= 5) return true;
  if (isRequestPathLike(fn.name) || isRequestPathLike(fn.filePath)) return true;
  for (const edge of edges) {
    const caller = functionsById.get(edge.fromId);
    if (!caller) continue;
    if (isRequestPathLike(caller.name) || isRequestPathLike(caller.filePath)) {
      return true;
    }
  }
  return false;
}

function summarizeRegressions(
  analyses: ComplexityAnalysis[],
  regressions: ComplexityAnalysis[],
  hotPathRegressions: ComplexityAnalysis[],
): string {
  if (analyses.length === 0) {
    return 'No target functions were analyzable for performance regression.';
  }
  if (regressions.length === 0) {
    return `Analyzed ${analyses.length} function(s); no complexity regressions detected.`;
  }
  return `${regressions.length} regression(s) detected across ${analyses.length} function(s), including ${hotPathRegressions.length} hot-path regression(s).`;
}

function resolveFunctionContext(
  targetId: string,
  functionsById: Map<string, FunctionKnowledge>,
  allFunctions: FunctionKnowledge[],
): FunctionContext | null {
  const direct = functionsById.get(targetId);
  if (direct) {
    return {
      fn: direct,
      filePath: normalizePath(direct.filePath),
      functionName: direct.name,
    };
  }
  const fallbackName = parseFunctionNameFromId(targetId);
  const fallback = allFunctions.find((fn) => fn.name === fallbackName);
  if (!fallback) return null;
  return {
    fn: fallback,
    filePath: normalizePath(fallback.filePath),
    functionName: fallback.name,
  };
}

export function createPerformanceRegressionSensorConstruction(): Construction<
  PerformanceSensorInput,
  PerformanceSensorOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'performance-regression-sensor',
    name: 'Performance Regression Sensor',
    description: 'Detects asymptotic complexity regressions in changed functions and escalates hot-path risk.',
    async execute(input: PerformanceSensorInput, context?: Context<unknown>) {
      const targets = input.targets ?? [];
      if (targets.length === 0) {
        throw new ConstructionError(
          'targets must include at least one function identifier.',
          'performance-regression-sensor',
        );
      }

      const storage = await resolveStorage(context);
      if (!storage) {
        return ok<PerformanceSensorOutput, ConstructionError>({
          analyses: [],
          regressions: [],
          hotPathRegressions: [],
          agentSummary: 'Performance regression analysis unavailable: runtime storage context is missing.',
        });
      }

      const functions = await storage.getFunctions({ limit: 25_000 });
      const functionsById = new Map<string, FunctionKnowledge>();
      for (const fn of functions) functionsById.set(fn.id, fn);

      const analyses: ComplexityAnalysis[] = [];
      for (const targetId of targets) {
        const contextEntry = resolveFunctionContext(targetId, functionsById, functions);
        if (!contextEntry) continue;
        const { fn, functionName, filePath } = contextEntry;

        let currentEstimate: ComplexityEstimate;
        try {
          const workspaceRoot = resolveWorkspaceRoot(context, filePath);
          const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
          const source = await fs.readFile(absolutePath, 'utf8');
          currentEstimate = analyzeComplexityFromCode(source, functionName);
          if (currentEstimate.complexity === 'unknown') {
            currentEstimate = estimateComplexityFromSemantics(fn);
          }
        } catch {
          currentEstimate = estimateComplexityFromSemantics(fn);
        }

        const previousEstimate = complexityFromDiff(input.diff, filePath, functionName);
        const previousComplexity = previousEstimate?.complexity;
        const currentRank = COMPLEXITY_RANK[currentEstimate.complexity];
        const previousRank = previousComplexity ? COMPLEXITY_RANK[previousComplexity] : undefined;
        const isRegression = previousRank !== undefined && previousRank >= 0 && currentRank > previousRank;

        const hotPath = await detectHotPath(storage, functionsById, fn.id, fn);
        if (input.hotPathsOnly && !hotPath) continue;

        const typicalInputSize = inferTypicalInputSize(fn, hotPath, input.inputSizeHints);
        const estimatedImpact = typicalInputSize ? formatImpact(currentEstimate.complexity, typicalInputSize) : undefined;

        let severity: 'critical' | 'warning' | 'info' = 'info';
        if (isRegression) {
          severity = hotPath && currentRank >= COMPLEXITY_RANK['O(n^2)'] ? 'critical' : 'warning';
        } else if (hotPath && currentRank >= COMPLEXITY_RANK['O(n^2)']) {
          severity = 'warning';
        }

        const regressionPattern = isRegression
          ? `complexity increased from ${previousComplexity ?? 'unknown'} to ${currentEstimate.complexity} (${currentEstimate.reason})`
          : undefined;

        analyses.push({
          functionId: fn.id,
          filePath,
          functionName,
          currentComplexity: currentEstimate.complexity,
          previousComplexity,
          isHotPath: hotPath,
          typicalInputSize,
          estimatedImpact,
          regressionPattern,
          severity,
          confidence: currentEstimate.confidence,
        });
      }

      const regressions = analyses.filter((entry) => entry.regressionPattern !== undefined);
      const hotPathRegressions = regressions.filter((entry) => entry.isHotPath);
      return ok<PerformanceSensorOutput, ConstructionError>({
        analyses,
        regressions,
        hotPathRegressions,
        agentSummary: summarizeRegressions(analyses, regressions, hotPathRegressions),
      });
    },
  };
}
