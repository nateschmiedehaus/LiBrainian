import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { FunctionId } from '../../core/function_range_mapper.js';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction } from '../types.js';

export type TestSlopCheck =
  | 'tautological_assertions'
  | 'mock_passthrough'
  | 'wrong_mock_scope'
  | 'missing_edge_cases'
  | 'snapshot_without_intent'
  | 'undefined_behavior';

export interface TestSlopInput {
  testPaths: string[];
  sourcePaths?: string[];
  checks?: TestSlopCheck[];
}

export interface TestSlopViolation {
  testFilePath: string;
  testName: string;
  violationType: TestSlopCheck;
  description: string;
  problemLine: { line: number; column: number; code: string };
  suggestedFix?: string;
  undetectedConditions: string[];
  severity: 'critical' | 'warning' | 'info';
}

export interface TestSlopOutput {
  violations: TestSlopViolation[];
  critical: TestSlopViolation[];
  warnings: TestSlopViolation[];
  effectivelyUntested: FunctionId[];
  agentSummary: string;
  effectiveCoverageEstimate: number;
}

interface SourceFunction {
  id: FunctionId;
  name: string;
  async: boolean;
  hasPostconditionContract: boolean;
}

interface TestCaseContext {
  testFilePath: string;
  testName: string;
  sourceFile: ts.SourceFile;
  callbackNode: ts.FunctionLikeDeclaration;
  callbackText: string;
  referencedFunctionNames: Set<string>;
}

const DEFAULT_CHECKS: readonly TestSlopCheck[] = [
  'tautological_assertions',
  'mock_passthrough',
  'wrong_mock_scope',
  'missing_edge_cases',
  'snapshot_without_intent',
  'undefined_behavior',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;
const EDGE_CASE_HINT_PATTERN = /\b(toThrow|rejects|throws|invalid|boundary|edge|negative|zero|null|undefined|empty|error)\b/i;

function normalizeChecks(checks?: TestSlopCheck[]): Set<TestSlopCheck> {
  if (!checks || checks.length === 0) {
    return new Set(DEFAULT_CHECKS);
  }
  return new Set(checks);
}

function getNodeLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function getNodeColumn(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character + 1;
}

function isTestCall(call: ts.CallExpression): boolean {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text === 'it' || expression.text === 'test';
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return expression.expression.text === 'it' || expression.expression.text === 'test';
  }
  return false;
}

function readTestName(call: ts.CallExpression): string {
  const [firstArg] = call.arguments;
  if (firstArg && ts.isStringLiteralLike(firstArg)) {
    return firstArg.text;
  }
  return 'unnamed test';
}

function readLiteralKey(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isNumericLiteral(node)) return `n:${node.text}`;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return `s:${node.text}`;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'b:true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'b:false';
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
  return undefined;
}

function normalizeExprText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).replace(/\s+/g, '');
}

async function collectFiles(inputPaths: string[], predicate: (filePath: string) => boolean): Promise<string[]> {
  const output: string[] = [];

  async function walk(entryPath: string): Promise<void> {
    let fileStat;
    try {
      fileStat = await stat(entryPath);
    } catch {
      return;
    }

    if (fileStat.isDirectory()) {
      const entries = await readdir(entryPath);
      for (const entry of entries) {
        await walk(path.join(entryPath, entry));
      }
      return;
    }

    if (!fileStat.isFile()) return;
    const absolute = path.resolve(entryPath);
    if (predicate(absolute)) {
      output.push(absolute);
    }
  }

  for (const inputPath of inputPaths) {
    await walk(path.resolve(inputPath));
  }
  return output;
}

function collectSourceFunctions(filePath: string, content: string): SourceFunction[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const functions: SourceFunction[] = [];

  const pushFunction = (
    name: string,
    node: ts.Node,
    isAsync: boolean,
  ): void => {
    const tags = ts.getJSDocTags(node);
    const hasPostconditionContract = tags.some((tag) => tag.tagName.getText(sourceFile).toLowerCase() === 'postcondition');
    functions.push({
      id: `${filePath}:${name}` as FunctionId,
      name,
      async: isAsync,
      hasPostconditionContract,
    });
  };

  const hasAsyncModifier = (node: ts.Node): boolean => {
    const modifiers = (node as ts.HasModifiers).modifiers;
    if (!modifiers) return false;
    return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushFunction(node.name.text, node, hasAsyncModifier(node));
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          pushFunction(declaration.name.text, declaration, declaration.initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
}

function classifyUndetectedCondition(actualExpressionText: string): string {
  const lowered = actualExpressionText.toLowerCase();
  if (lowered.includes('discount')) {
    return 'discount code not applied to total';
  }
  return 'assertion validates mock value passthrough rather than transformed behavior';
}

function pushViolation(
  violations: TestSlopViolation[],
  dedupe: Set<string>,
  violation: TestSlopViolation,
): void {
  const key = [
    violation.testFilePath,
    violation.testName,
    violation.violationType,
    violation.problemLine.line,
    violation.problemLine.code,
  ].join('|');
  if (dedupe.has(key)) {
    return;
  }
  dedupe.add(key);
  violations.push(violation);
}

function analyzeTestCase(
  testCase: TestCaseContext,
  checks: Set<TestSlopCheck>,
  sourceByName: Map<string, SourceFunction>,
  violations: TestSlopViolation[],
  dedupe: Set<string>,
): void {
  const mockLiteralKeys = new Set<string>();
  const mockedMethodNames: string[] = [];
  const resultVariables = new Set<string>();
  let totalAssertions = 0;
  let snapshotAssertions = 0;

  const callbackNode = testCase.callbackNode;
  const sourceFile = testCase.sourceFile;

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      resultVariables.add(node.name.text);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const maybeFn = sourceByName.get(node.expression.text);
      if (maybeFn) {
        testCase.referencedFunctionNames.add(maybeFn.name);
        if (
          checks.has('undefined_behavior') &&
          maybeFn.async &&
          !ts.isAwaitExpression(node.parent) &&
          !ts.isReturnStatement(node.parent)
        ) {
          pushViolation(violations, dedupe, {
            testFilePath: testCase.testFilePath,
            testName: testCase.testName,
            violationType: 'undefined_behavior',
            description: `Async function ${maybeFn.name}() is called without await/return, so assertions may run before side effects complete.`,
            problemLine: {
              line: getNodeLine(sourceFile, node),
              column: getNodeColumn(sourceFile, node),
              code: node.getText(sourceFile),
            },
            suggestedFix: `Await or return ${maybeFn.name}() before asserting outcomes.`,
            undetectedConditions: ['race-condition bugs hidden by non-awaited async behavior'],
            severity: 'warning',
          });
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text;
      if (
        (matcher === 'mockReturnValue' || matcher === 'mockResolvedValue' || matcher === 'mockImplementation') &&
        checks.has('mock_passthrough')
      ) {
        const key = readLiteralKey(node.arguments[0]);
        if (key) {
          mockLiteralKeys.add(key);
        }
      }

      if (matcher === 'spyOn' && checks.has('wrong_mock_scope')) {
        const methodArg = node.arguments[1];
        if (methodArg && ts.isStringLiteral(methodArg)) {
          mockedMethodNames.push(methodArg.text);
        }
      }

      const expectCall = node.expression.expression;
      if (
        ts.isCallExpression(expectCall) &&
        ts.isIdentifier(expectCall.expression) &&
        expectCall.expression.text === 'expect'
      ) {
        totalAssertions += 1;
        const actualArg = expectCall.arguments[0];

        if (matcher === 'toMatchSnapshot' || matcher === 'toMatchInlineSnapshot') {
          snapshotAssertions += 1;
        }

        if (
          checks.has('tautological_assertions') &&
          (matcher === 'toBe' || matcher === 'toEqual' || matcher === 'toStrictEqual') &&
          actualArg &&
          node.arguments[0]
        ) {
          const actualText = normalizeExprText(sourceFile, actualArg);
          const expectedText = normalizeExprText(sourceFile, node.arguments[0]);
          if (actualText.length > 0 && actualText === expectedText) {
            pushViolation(violations, dedupe, {
              testFilePath: testCase.testFilePath,
              testName: testCase.testName,
              violationType: 'tautological_assertions',
              description: 'Assertion compares a value to itself, so it cannot fail when behavior regresses.',
              problemLine: {
                line: getNodeLine(sourceFile, node),
                column: getNodeColumn(sourceFile, node),
                code: node.getText(sourceFile),
              },
              suggestedFix: 'Assert against a derived expected value that would differ if behavior changes.',
              undetectedConditions: ['logic regressions can pass despite failing behavior'],
              severity: 'critical',
            });
          }
        }

        if (
          checks.has('mock_passthrough') &&
          (matcher === 'toBe' || matcher === 'toEqual' || matcher === 'toStrictEqual') &&
          actualArg &&
          node.arguments[0]
        ) {
          const expectedKey = readLiteralKey(node.arguments[0]);
          const actualText = actualArg.getText(sourceFile);
          const referencesResult = Array.from(resultVariables).some((name) =>
            actualText === name || actualText.startsWith(`${name}.`),
          );
          if (expectedKey && mockLiteralKeys.has(expectedKey) && referencesResult) {
            pushViolation(violations, dedupe, {
              testFilePath: testCase.testFilePath,
              testName: testCase.testName,
              violationType: 'mock_passthrough',
              description: 'Assertion validates a literal mock return value instead of behavior transformed by the system under test.',
              problemLine: {
                line: getNodeLine(sourceFile, node),
                column: getNodeColumn(sourceFile, node),
                code: node.getText(sourceFile),
              },
              suggestedFix: 'Assert the transformed business outcome (for example resulting total), not the mocked intermediate value.',
              undetectedConditions: [classifyUndetectedCondition(actualText)],
              severity: 'critical',
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(callbackNode, visit);

  if (checks.has('snapshot_without_intent') && snapshotAssertions > 0 && snapshotAssertions === totalAssertions) {
    pushViolation(violations, dedupe, {
      testFilePath: testCase.testFilePath,
      testName: testCase.testName,
      violationType: 'snapshot_without_intent',
      description: 'Test only asserts snapshots without explicit behavior intent checks.',
      problemLine: {
        line: getNodeLine(sourceFile, callbackNode),
        column: getNodeColumn(sourceFile, callbackNode),
        code: readTestNameFromNode(callbackNode, sourceFile),
      },
      suggestedFix: 'Add explicit assertions for behavior-critical fields before or after snapshot checks.',
      undetectedConditions: ['unintended output drift that still matches broad snapshots'],
      severity: 'warning',
    });
  }

  if (checks.has('wrong_mock_scope')) {
    for (const methodName of mockedMethodNames) {
      const usageMatches = testCase.callbackText.match(new RegExp(`\\b${methodName}\\b`, 'g'));
      const usageCount = usageMatches?.length ?? 0;
      if (usageCount <= 1) {
        pushViolation(violations, dedupe, {
          testFilePath: testCase.testFilePath,
          testName: testCase.testName,
          violationType: 'wrong_mock_scope',
          description: `Mocked method ${methodName} appears unused by the exercised assertions/SUT path.`,
          problemLine: {
            line: getNodeLine(sourceFile, callbackNode),
            column: getNodeColumn(sourceFile, callbackNode),
            code: `spyOn(..., '${methodName}')`,
          },
          suggestedFix: `Verify ${methodName} affects observable outcomes or remove the mock.`,
          undetectedConditions: ['tests pass while mock wiring is disconnected from behavior'],
          severity: 'warning',
        });
      }
    }
  }
}

function readTestNameFromNode(callbackNode: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  const callExpression = callbackNode.parent;
  if (callExpression && ts.isCallExpression(callExpression)) {
    return readTestName(callExpression);
  }
  return callbackNode.getText(sourceFile);
}

function applyMissingEdgeCaseCheck(
  checks: Set<TestSlopCheck>,
  sourceByName: Map<string, SourceFunction>,
  testCases: TestCaseContext[],
  violations: TestSlopViolation[],
  dedupe: Set<string>,
): void {
  if (!checks.has('missing_edge_cases')) {
    return;
  }

  for (const sourceFn of sourceByName.values()) {
    if (!sourceFn.hasPostconditionContract) {
      continue;
    }
    const coveringTests = testCases.filter((testCase) => testCase.referencedFunctionNames.has(sourceFn.name));
    if (coveringTests.length === 0) {
      continue;
    }
    const hasEdgeCoverage = coveringTests.some((testCase) => EDGE_CASE_HINT_PATTERN.test(testCase.callbackText));
    if (hasEdgeCoverage) {
      continue;
    }
    const first = coveringTests[0];
    pushViolation(violations, dedupe, {
      testFilePath: first.testFilePath,
      testName: first.testName,
      violationType: 'missing_edge_cases',
      description: `Function ${sourceFn.name} has documented postconditions but tests do not exercise boundary or failure paths.`,
      problemLine: {
        line: getNodeLine(first.sourceFile, first.callbackNode),
        column: getNodeColumn(first.sourceFile, first.callbackNode),
        code: sourceFn.name,
      },
      suggestedFix: `Add explicit edge-case tests for ${sourceFn.name} covering postcondition failure boundaries.`,
      undetectedConditions: ['postcondition regressions can ship despite nominal coverage'],
      severity: 'info',
    });
  }
}

function computeEffectiveCoverageEstimate(
  referencedFunctions: Set<string>,
  effectivelyUntested: FunctionId[],
): number {
  if (referencedFunctions.size === 0) {
    return 100;
  }
  const meaningful = Math.max(0, referencedFunctions.size - effectivelyUntested.length);
  return Math.round((meaningful / referencedFunctions.size) * 1000) / 10;
}

async function analyzeTestSlop(input: TestSlopInput): Promise<TestSlopOutput> {
  const checks = normalizeChecks(input.checks);

  const testFiles = await collectFiles(input.testPaths, (filePath) => TEST_FILE_PATTERN.test(filePath));
  const sourceFiles = input.sourcePaths && input.sourcePaths.length > 0
    ? await collectFiles(input.sourcePaths, (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    : [];

  const sourceFunctions: SourceFunction[] = [];
  for (const sourceFilePath of sourceFiles) {
    const content = await readFile(sourceFilePath, 'utf8');
    sourceFunctions.push(...collectSourceFunctions(sourceFilePath, content));
  }
  const sourceByName = new Map(sourceFunctions.map((fn) => [fn.name, fn]));

  const violations: TestSlopViolation[] = [];
  const dedupe = new Set<string>();
  const testCases: TestCaseContext[] = [];

  for (const testFilePath of testFiles) {
    const content = await readFile(testFilePath, 'utf8');
    const sourceFile = ts.createSourceFile(testFilePath, content, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isTestCall(node)) {
        const callback = node.arguments[1];
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const testCase: TestCaseContext = {
            testFilePath,
            testName: readTestName(node),
            sourceFile,
            callbackNode: callback,
            callbackText: callback.getText(sourceFile),
            referencedFunctionNames: new Set<string>(),
          };
          analyzeTestCase(testCase, checks, sourceByName, violations, dedupe);
          testCases.push(testCase);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  applyMissingEdgeCaseCheck(checks, sourceByName, testCases, violations, dedupe);

  const violationMapByTest = new Map<string, TestSlopViolation[]>();
  for (const violation of violations) {
    const key = `${violation.testFilePath}|${violation.testName}`;
    const existing = violationMapByTest.get(key) ?? [];
    existing.push(violation);
    violationMapByTest.set(key, existing);
  }

  const referencedFunctions = new Set<string>();
  const effectivelyUntested = new Set<FunctionId>();

  for (const testCase of testCases) {
    for (const fnName of testCase.referencedFunctionNames) {
      referencedFunctions.add(fnName);
    }
  }

  for (const fnName of referencedFunctions) {
    const sourceFn = sourceByName.get(fnName);
    if (!sourceFn) continue;
    const coveringTests = testCases.filter((testCase) => testCase.referencedFunctionNames.has(fnName));
    if (coveringTests.length === 0) continue;
    const hasMeaningfulTest = coveringTests.some((testCase) => {
      const key = `${testCase.testFilePath}|${testCase.testName}`;
      const testViolations = violationMapByTest.get(key) ?? [];
      return testViolations.every((violation) => violation.severity === 'info');
    });
    if (!hasMeaningfulTest) {
      effectivelyUntested.add(sourceFn.id);
    }
  }

  const critical = violations.filter((violation) => violation.severity === 'critical');
  const warnings = violations.filter((violation) => violation.severity === 'warning');
  const effectivelyUntestedList = Array.from(effectivelyUntested).sort();
  const effectiveCoverageEstimate = computeEffectiveCoverageEstimate(referencedFunctions, effectivelyUntestedList);

  const agentSummary = [
    `violations=${violations.length}`,
    `critical=${critical.length}`,
    `warnings=${warnings.length}`,
    `effectivelyUntested=${effectivelyUntestedList.length}`,
    `effectiveCoverage=${effectiveCoverageEstimate}%`,
  ].join(' | ');

  return {
    violations,
    critical,
    warnings,
    effectivelyUntested: effectivelyUntestedList,
    agentSummary,
    effectiveCoverageEstimate,
  };
}

export function createTestSlopDetectorConstruction(): Construction<
  TestSlopInput,
  TestSlopOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'test-slop-detector',
    name: 'Test Slop Detector',
    description: 'Detects tests that look comprehensive but provide weak or tautological behavioral guarantees.',
    async execute(input: TestSlopInput) {
      if (!Array.isArray(input.testPaths) || input.testPaths.length === 0) {
        throw new ConstructionError('test-slop-detector requires at least one testPaths entry', 'test-slop-detector');
      }
      const output = await analyzeTestSlop(input);
      return ok<TestSlopOutput, ConstructionError>(output);
    },
  };
}
