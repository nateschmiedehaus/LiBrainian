import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { FunctionId } from '../../core/function_range_mapper.js';
import {
  computeIntentBehaviorCoherence,
  tokenizeForIntentBehavior,
} from '../intent_behavior_coherence.js';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction } from '../types.js';

export interface IntentBehaviorCoherenceInput {
  targets?: FunctionId[];
  fromEntrypoints?: FunctionId[];
  divergenceThreshold?: number;
  prioritizeByCriticality?: boolean;
  workspaceRoot?: string;
}

export type DivergenceType =
  | 'does_less_than_claimed'
  | 'does_more_than_claimed'
  | 'does_different_thing'
  | 'outdated_docstring';

export interface CoherenceViolation {
  functionId: FunctionId;
  filePath: string;
  functionName: string;
  declaredIntent: string;
  behavioralDescription: string;
  divergenceScore: number;
  divergenceType: DivergenceType;
  criticalityScore: number;
  suggestedDocstring?: string;
}

export interface IntentBehaviorCoherenceOutput {
  violations: CoherenceViolation[];
  criticalViolations: CoherenceViolation[];
  agentSummary: string;
}

interface ParsedFunction {
  id: FunctionId;
  filePath: string;
  name: string;
  isPublic: boolean;
  docstring?: string;
  calls: string[];
  sideEffects: string[];
  returnShape: 'boolean' | 'object' | 'array' | 'number' | 'string' | 'void' | 'unknown';
  behaviorDescription: string;
}

interface CallerStats {
  direct: number;
  transitive: number;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SIDE_EFFECT_CALL_HINTS = new Set([
  'writeFile',
  'appendFile',
  'unlink',
  'rm',
  'rename',
  'mkdir',
  'rmdir',
  'save',
  'persist',
  'update',
  'patch',
  'delete',
  'insert',
  'create',
  'emit',
  'send',
  'publish',
  'log',
  'warn',
  'error',
  'fetch',
  'request',
  'post',
  'put',
]);
const SIDE_EFFECT_INTENT_HINTS = new Set([
  'write',
  'save',
  'persist',
  'delete',
  'update',
  'create',
  'send',
  'emit',
  'log',
  'publish',
  'fetch',
  'request',
  'store',
]);
const LESS_THAN_CLAIM_HINTS = new Set([
  'validate',
  'verify',
  'authorize',
  'authenticate',
  'permission',
  'permissions',
  'secure',
  'sanitize',
  'encrypt',
  'guard',
  'check',
  'safety',
]);
const ACTION_VERB_HINTS = new Set([
  'fetch',
  'get',
  'read',
  'load',
  'find',
  'query',
  'list',
  'search',
  'compute',
  'calculate',
  'build',
  'generate',
  'create',
  'update',
  'delete',
  'remove',
  'sort',
  'map',
  'filter',
  'validate',
  'verify',
  'authorize',
  'authenticate',
  'check',
]);
const SECURITY_PATH_HINT = /(auth|authorize|authentication|permission|access|token|session|credential|security)/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function splitIdentifier(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = (node as ts.HasModifiers).modifiers;
  return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function hasPrivateModifier(node: ts.Node): boolean {
  const modifiers = (node as ts.HasModifiers).modifiers;
  return Boolean(
    modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    ),
  );
}

function collectCalls(body: ts.ConciseBody): string[] {
  const calls = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calls.add(node.expression.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return uniqueSorted(calls);
}

function collectSideEffects(body: ts.ConciseBody): string[] {
  const sideEffects = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.EqualsToken ||
        operator === ts.SyntaxKind.PlusEqualsToken ||
        operator === ts.SyntaxKind.MinusEqualsToken ||
        operator === ts.SyntaxKind.AsteriskEqualsToken ||
        operator === ts.SyntaxKind.SlashEqualsToken
      ) {
        if (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) {
          sideEffects.add('mutation');
        }
      }
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        sideEffects.add('mutation');
      }
    }
    if (ts.isCallExpression(node)) {
      const callName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : undefined;
      if (callName && SIDE_EFFECT_CALL_HINTS.has(callName.toLowerCase())) {
        sideEffects.add(callName);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return uniqueSorted(sideEffects);
}

function inferReturnShape(body: ts.ConciseBody | undefined): ParsedFunction['returnShape'] {
  if (!body) return 'unknown';
  if (!ts.isBlock(body)) {
    if (body.kind === ts.SyntaxKind.TrueKeyword || body.kind === ts.SyntaxKind.FalseKeyword) {
      return 'boolean';
    }
    if (ts.isObjectLiteralExpression(body)) return 'object';
    if (ts.isArrayLiteralExpression(body)) return 'array';
    if (ts.isNumericLiteral(body)) return 'number';
    if (ts.isStringLiteral(body) || ts.isNoSubstitutionTemplateLiteral(body) || ts.isTemplateExpression(body)) {
      return 'string';
    }
    return 'unknown';
  }

  const returns: ts.Expression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== (body as unknown as ts.Node)) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      returns.push(node.expression);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(body);

  if (returns.length === 0) return 'void';
  if (returns.every((node) => node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword)) {
    return 'boolean';
  }
  if (returns.some((node) => ts.isObjectLiteralExpression(node))) return 'object';
  if (returns.some((node) => ts.isArrayLiteralExpression(node))) return 'array';
  if (returns.some((node) => ts.isNumericLiteral(node))) return 'number';
  if (
    returns.some(
      (node) =>
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node),
    )
  ) {
    return 'string';
  }
  return 'unknown';
}

function readDocstring(node: ts.Node): string | undefined {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!docs || docs.length === 0) {
    return undefined;
  }
  const text = normalizeWhitespace(docs.map((doc) => doc.getText()).join(' '));
  return text.length > 0 ? text : undefined;
}

function buildBehaviorDescription(
  body: ts.ConciseBody | undefined,
  calls: string[],
  sideEffects: string[],
  returnShape: ParsedFunction['returnShape'],
): string {
  const snippet = body ? normalizeWhitespace(body.getText()).slice(0, 220) : '';
  const callPart = calls.length > 0 ? calls.slice(0, 8).join(', ') : 'none';
  const sideEffectPart = sideEffects.length > 0 ? sideEffects.slice(0, 8).join(', ') : 'none';
  return `returns=${returnShape}; calls=[${callPart}]; sideEffects=[${sideEffectPart}]; implementation=${snippet}`;
}

function parseFunctionsFromSource(filePath: string, content: string): ParsedFunction[] {
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const parsed: ParsedFunction[] = [];

  const pushParsed = (
    name: string,
    node: ts.Node,
    body: ts.ConciseBody | undefined,
    isPublic: boolean,
  ): void => {
    const calls = body ? collectCalls(body) : [];
    const sideEffects = body ? collectSideEffects(body) : [];
    const returnShape = inferReturnShape(body);
    parsed.push({
      id: `${filePath}:${name}` as FunctionId,
      filePath,
      name,
      isPublic,
      docstring: readDocstring(node),
      calls,
      sideEffects,
      returnShape,
      behaviorDescription: buildBehaviorDescription(body, calls, sideEffects, returnShape),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushParsed(node.name.text, node, node.body, hasExportModifier(node));
    } else if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          pushParsed(declaration.name.text, declaration, declaration.initializer.body, exported);
        }
      }
    } else if (ts.isMethodDeclaration(node)) {
      const classNode = node.parent;
      const className =
        ts.isClassLike(classNode) && classNode.name
          ? classNode.name.text
          : 'AnonymousClass';
      const methodName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(source);
      const classExported = ts.isClassLike(classNode) ? hasExportModifier(classNode) : false;
      const publicMethod = !hasPrivateModifier(node);
      pushParsed(
        `${className}.${methodName}`,
        node,
        node.body,
        classExported && publicMethod,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return parsed;
}

async function collectSourceFiles(workspaceRoot: string): Promise<string[]> {
  const files: string[] = [];
  const root = path.resolve(workspaceRoot);

  async function walk(currentPath: string): Promise<void> {
    let stats;
    try {
      stats = await stat(currentPath);
    } catch {
      return;
    }

    if (stats.isDirectory()) {
      const basename = path.basename(currentPath);
      if (
        basename === '.git' ||
        basename === 'node_modules' ||
        basename === 'dist' ||
        basename === '.librarian'
      ) {
        return;
      }
      const children = await readdir(currentPath);
      for (const child of children) {
        await walk(path.join(currentPath, child));
      }
      return;
    }

    if (!stats.isFile()) {
      return;
    }
    const ext = path.extname(currentPath).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) {
      return;
    }
    files.push(path.relative(root, currentPath).replaceAll('\\', '/'));
  }

  await walk(root);
  return uniqueSorted(files);
}

function hasAnyToken(values: Set<string>, candidates: Set<string>): boolean {
  for (const value of values) {
    if (candidates.has(value)) {
      return true;
    }
  }
  return false;
}

function coverageRatio(claimTokens: Set<string>, behaviorTokens: Set<string>): number {
  if (claimTokens.size === 0) {
    return 1;
  }
  let covered = 0;
  for (const token of claimTokens) {
    if (behaviorTokens.has(token)) {
      covered += 1;
    }
  }
  return covered / claimTokens.size;
}

function normalizeActionToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function hasActionVerbAlignment(functionName: string, behaviorDescription: string): boolean {
  const behaviorText = behaviorDescription.toLowerCase();
  const nameTokens = splitIdentifier(functionName).split(/\s+/g).filter(Boolean);
  for (const token of nameTokens) {
    const normalized = normalizeActionToken(token);
    if (!ACTION_VERB_HINTS.has(normalized)) continue;
    if (behaviorText.includes(normalized)) {
      return true;
    }
  }
  return false;
}

function detectDivergenceType(
  divergenceScore: number,
  declaredTokens: Set<string>,
  nameTokens: Set<string>,
  docTokens: Set<string>,
  behaviorTokens: Set<string>,
  sideEffects: string[],
): DivergenceType {
  const claimTokens = new Set<string>();
  for (const token of declaredTokens) {
    if (LESS_THAN_CLAIM_HINTS.has(token)) {
      claimTokens.add(token);
    }
  }

  if (claimTokens.size > 0 && coverageRatio(claimTokens, behaviorTokens) < 0.35) {
    return 'does_less_than_claimed';
  }

  if (sideEffects.length > 0 && !hasAnyToken(declaredTokens, SIDE_EFFECT_INTENT_HINTS)) {
    return 'does_more_than_claimed';
  }

  if (docTokens.size > 0) {
    const docCoverage = coverageRatio(docTokens, behaviorTokens);
    const nameCoverage = coverageRatio(nameTokens, behaviorTokens);
    if (docCoverage + 0.2 < nameCoverage) {
      return 'outdated_docstring';
    }
  }

  if (divergenceScore >= 0.6) {
    return 'does_different_thing';
  }
  return 'outdated_docstring';
}

function isSecuritySensitiveName(name: string): boolean {
  return SECURITY_PATH_HINT.test(name);
}

function computeCallerStats(
  functionId: FunctionId,
  reverseGraph: Map<FunctionId, Set<FunctionId>>,
): CallerStats {
  const direct = reverseGraph.get(functionId) ?? new Set<FunctionId>();
  const seen = new Set<FunctionId>(direct);
  const queue = [...direct];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const parents = reverseGraph.get(current);
    if (!parents) continue;
    for (const parent of parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push(parent);
    }
  }
  return {
    direct: direct.size,
    transitive: Math.max(0, seen.size - direct.size),
  };
}

function isSecurityReachable(
  functionId: FunctionId,
  parsedById: Map<FunctionId, ParsedFunction>,
  reverseGraph: Map<FunctionId, Set<FunctionId>>,
): boolean {
  const own = parsedById.get(functionId);
  if (own && isSecuritySensitiveName(own.name)) {
    return true;
  }

  const seen = new Set<FunctionId>([functionId]);
  const queue: FunctionId[] = [functionId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const callers = reverseGraph.get(current);
    if (!callers) continue;
    for (const caller of callers) {
      if (seen.has(caller)) continue;
      seen.add(caller);
      const callerFunction = parsedById.get(caller);
      if (callerFunction && isSecuritySensitiveName(callerFunction.name)) {
        return true;
      }
      queue.push(caller);
    }
  }

  return false;
}

function computeEntrypointReachability(
  entrypoints: Set<FunctionId>,
  forwardGraph: Map<FunctionId, Set<FunctionId>>,
): Set<FunctionId> {
  const reachable = new Set<FunctionId>(entrypoints);
  const queue: FunctionId[] = [...entrypoints];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const children = forwardGraph.get(current);
    if (!children) continue;
    for (const child of children) {
      if (reachable.has(child)) continue;
      reachable.add(child);
      queue.push(child);
    }
  }
  return reachable;
}

function buildSuggestedDocstring(parsed: ParsedFunction): string {
  const calls = parsed.calls.length > 0
    ? `Calls: ${parsed.calls.slice(0, 4).join(', ')}.`
    : 'No significant external calls.';
  const sideEffects = parsed.sideEffects.length > 0
    ? `Side effects: ${parsed.sideEffects.slice(0, 3).join(', ')}.`
    : 'No observed side effects.';
  return `Performs ${parsed.name} behavior with ${parsed.returnShape} return. ${calls} ${sideEffects}`.trim();
}

async function summarizeIntentBehaviorCoherence(
  input: IntentBehaviorCoherenceInput,
): Promise<IntentBehaviorCoherenceOutput> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const files = await collectSourceFiles(workspaceRoot);
  const parsedFunctions: ParsedFunction[] = [];
  for (const filePath of files) {
    const absolutePath = path.join(workspaceRoot, filePath);
    let content: string;
    try {
      content = await readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    parsedFunctions.push(...parseFunctionsFromSource(filePath, content));
  }

  const parsedById = new Map<FunctionId, ParsedFunction>();
  const idsByName = new Map<string, Set<FunctionId>>();
  for (const parsed of parsedFunctions) {
    parsedById.set(parsed.id, parsed);
    const existing = idsByName.get(parsed.name) ?? new Set<FunctionId>();
    existing.add(parsed.id);
    idsByName.set(parsed.name, existing);
  }

  const forwardGraph = new Map<FunctionId, Set<FunctionId>>();
  const reverseGraph = new Map<FunctionId, Set<FunctionId>>();
  for (const parsed of parsedFunctions) {
    const callees = new Set<FunctionId>();
    for (const callName of parsed.calls) {
      const targets = idsByName.get(callName);
      if (!targets) continue;
      for (const target of targets) {
        callees.add(target);
      }
    }
    forwardGraph.set(parsed.id, callees);
  }
  for (const [caller, callees] of forwardGraph) {
    for (const callee of callees) {
      const reverse = reverseGraph.get(callee) ?? new Set<FunctionId>();
      reverse.add(caller);
      reverseGraph.set(callee, reverse);
    }
  }

  const threshold = input.divergenceThreshold ?? 0.35;
  const prioritizeByCriticality = input.prioritizeByCriticality ?? true;
  const targets = new Set<FunctionId>(input.targets ?? []);
  const entrypoints = new Set<FunctionId>(input.fromEntrypoints ?? []);
  const reachableFromEntrypoints =
    entrypoints.size > 0
      ? computeEntrypointReachability(entrypoints, forwardGraph)
      : undefined;

  let candidates = parsedFunctions.filter((parsed) => parsed.isPublic);
  if (targets.size > 0) {
    candidates = candidates.filter((parsed) => targets.has(parsed.id));
  }
  if (reachableFromEntrypoints) {
    candidates = candidates.filter((parsed) => reachableFromEntrypoints.has(parsed.id));
  }

  const violations: CoherenceViolation[] = [];
  for (const parsed of candidates) {
    const nameIntent = splitIdentifier(parsed.name);
    const docIntent = parsed.docstring ? normalizeWhitespace(parsed.docstring) : '';
    const declaredIntent = normalizeWhitespace(`${nameIntent} ${docIntent}`);
    const declaredTokens = tokenizeForIntentBehavior(declaredIntent);
    const nameTokens = tokenizeForIntentBehavior(nameIntent);
    const docTokens = tokenizeForIntentBehavior(docIntent);
    if (declaredTokens.size === 0) {
      continue;
    }

    const coherence = computeIntentBehaviorCoherence(declaredIntent, parsed.behaviorDescription);
    let divergenceScore = clamp01(1 - coherence);
    const behaviorTokens = tokenizeForIntentBehavior(parsed.behaviorDescription);
    const hasStrongClaim =
      hasAnyToken(declaredTokens, LESS_THAN_CLAIM_HINTS) ||
      hasAnyToken(declaredTokens, SIDE_EFFECT_INTENT_HINTS);
    if (declaredTokens.size <= 3 && coherence >= 0.15 && !hasStrongClaim) {
      divergenceScore = Math.min(divergenceScore, 0.2);
    }
    const getterLike =
      splitIdentifier(parsed.name).startsWith('get ') &&
      parsed.sideEffects.length === 0 &&
      parsed.calls.length <= 1;
    if (getterLike && !hasStrongClaim) {
      divergenceScore = Math.min(divergenceScore, 0.2);
    }
    if (hasActionVerbAlignment(parsed.name, parsed.behaviorDescription) && divergenceScore < 0.75) {
      divergenceScore = Math.min(divergenceScore, 0.3);
    }

    const divergenceType = detectDivergenceType(
      divergenceScore,
      declaredTokens,
      nameTokens,
      docTokens,
      behaviorTokens,
      parsed.sideEffects,
    );
    const securityReachable = isSecurityReachable(parsed.id, parsedById, reverseGraph);
    const includeViolation =
      divergenceScore >= threshold ||
      (divergenceType === 'does_less_than_claimed' && securityReachable);
    if (!includeViolation) {
      continue;
    }

    const callerStats = computeCallerStats(parsed.id, reverseGraph);
    const criticalityScore = clamp01(
      callerStats.direct * 0.12 +
      callerStats.transitive * 0.04 +
      (securityReachable ? 0.72 : 0) +
      (reachableFromEntrypoints?.has(parsed.id) ? 0.12 : 0),
    );

    const violation: CoherenceViolation = {
      functionId: parsed.id,
      filePath: parsed.filePath,
      functionName: parsed.name,
      declaredIntent,
      behavioralDescription: parsed.behaviorDescription,
      divergenceScore: Math.round(divergenceScore * 1000) / 1000,
      divergenceType,
      criticalityScore: Math.round(criticalityScore * 1000) / 1000,
      suggestedDocstring: divergenceScore > 0.5 ? buildSuggestedDocstring(parsed) : undefined,
    };
    violations.push(violation);
  }

  violations.sort((a, b) => {
    if (prioritizeByCriticality) {
      const criticalityCompare = b.criticalityScore - a.criticalityScore;
      if (criticalityCompare !== 0) return criticalityCompare;
    }
    const divergenceCompare = b.divergenceScore - a.divergenceScore;
    if (divergenceCompare !== 0) return divergenceCompare;
    const fileCompare = a.filePath.localeCompare(b.filePath);
    if (fileCompare !== 0) return fileCompare;
    return a.functionName.localeCompare(b.functionName);
  });

  const criticalViolations = violations.filter(
    (violation) =>
      (violation.divergenceScore > 0.5 && violation.criticalityScore > 0.7) ||
      (violation.divergenceType === 'does_less_than_claimed' && violation.criticalityScore > 0),
  );

  const summaryParts = [
    `Intent-behavior coherence scan checked ${candidates.length} functions.`,
    `Violations: ${violations.length}; critical: ${criticalViolations.length}.`,
    `Threshold=${threshold.toFixed(2)}.`,
  ];
  if (violations.length > 0) {
    summaryParts.push(
      `Top divergence: ${violations[0].filePath}:${violations[0].functionName} (${violations[0].divergenceType}, score=${violations[0].divergenceScore.toFixed(2)}).`,
    );
  }

  return {
    violations,
    criticalViolations,
    agentSummary: summaryParts.join(' '),
  };
}

export function createIntentBehaviorCoherenceCheckerConstruction(): Construction<
  IntentBehaviorCoherenceInput,
  IntentBehaviorCoherenceOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'intent-behavior-coherence-checker',
    name: 'Intent Behavior Coherence Checker',
    description:
      'Flags functions where declared intent (name/docstring) diverges from implementation behavior, prioritizing security-critical call paths.',
    async execute(input: IntentBehaviorCoherenceInput) {
      const output = await summarizeIntentBehaviorCoherence(input);
      return ok<IntentBehaviorCoherenceOutput, ConstructionError>(output);
    },
  };
}
