import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import type { FunctionId } from '../../core/function_range_mapper.js';
import { parseUnifiedDiff } from '../../ingest/diff_indexer.js';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction } from '../types.js';

export type DiffFocusArea =
  | 'contracts'
  | 'blast_radius'
  | 'test_coverage'
  | 'security'
  | 'performance';

export interface DiffSummarizerInput {
  diff?: string;
  baseSha?: string;
  headSha?: string;
  focusAreas?: DiffFocusArea[];
  workspaceRoot?: string;
}

export interface FunctionSemanticDelta {
  functionId: FunctionId;
  name: string;
  filePath: string;
  changeKind: 'modified' | 'added' | 'deleted' | 'renamed' | 'extracted' | 'inlined';
  behaviorBefore: string | null;
  behaviorAfter: string | null;
  contractChanges: {
    weakenedPostconditions: string[];
    newPreconditions: string[];
    removedGuarantees: string[];
  };
  affectedCallers: FunctionId[];
  coverageDelta: { previouslyCovered: boolean; nowCovered: boolean };
  riskLevel: 'high' | 'medium' | 'low';
}

export interface DiffSemanticSummarizerOutput {
  deltas: FunctionSemanticDelta[];
  blastRadius: { directCallers: number; transitiveCallers: number; blastScore: number };
  criticalChanges: FunctionSemanticDelta[];
  newCoverageGaps: Array<{ functionId: FunctionId; uncoveredPaths: string[] }>;
  agentBriefing: string;
  reviewerSummary: string;
}

interface ParsedFunction {
  id: FunctionId;
  name: string;
  filePath: string;
  normalizedBody: string;
  behaviorSummary: string;
  calls: string[];
  returnsNullable: boolean;
  preconditions: string[];
  startLine: number;
}

interface DiffFilePair {
  oldPath?: string;
  newPath?: string;
}

interface SnapshotFunctionSets {
  before: ParsedFunction[];
  after: ParsedFunction[];
}

interface CallerImpact {
  direct: Set<FunctionId>;
  transitive: Set<FunctionId>;
  affected: Set<FunctionId>;
}

interface ExtractionEvidence {
  parentName: string;
  faithful: boolean;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const TEST_FILE_PATTERN = /(^|\/)__tests__\/.*\.(ts|tsx|js|jsx)$|(^|\/).+\.(test|spec)\.(ts|tsx|js|jsx)$/i;
const MAX_BRIEFING_WORDS = 1900;
const execFileAsync = promisify(execFile);

function normalizePath(filePath: string): string {
  return filePath.replace(/^\.?\//, '').replaceAll('\\', '/');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function toKey(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

function readNodeName(node: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

function isSourceFilePath(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function tokenize(code: string): Set<string> {
  const tokens = normalizeWhitespace(code).toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
  return new Set(tokens.filter((token) => token.length > 1));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function hasThrow(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (ts.isThrowStatement(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function expressionCouldBeNullish(expression: ts.Expression): boolean {
  if (expression.kind === ts.SyntaxKind.NullKeyword || expression.kind === ts.SyntaxKind.UndefinedKeyword) {
    return true;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return expressionCouldBeNullish(expression.expression);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return expressionCouldBeNullish(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return expressionCouldBeNullish(expression.whenTrue) || expressionCouldBeNullish(expression.whenFalse);
  }
  if (ts.isBinaryExpression(expression)) {
    return expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ? expressionCouldBeNullish(expression.left) && expressionCouldBeNullish(expression.right)
      : expressionCouldBeNullish(expression.left) || expressionCouldBeNullish(expression.right);
  }
  return false;
}

function collectCalls(body: ts.ConciseBody, sourceFile: ts.SourceFile): string[] {
  const calls = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calls.add(node.expression.name.text);
      } else if (ts.isElementAccessExpression(node.expression)) {
        const arg = node.expression.argumentExpression;
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          calls.add(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return uniqueSorted(calls).map((name) => name.trim()).filter((name) => name.length > 0 && name !== sourceFile.fileName);
}

function collectReturnsNullable(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) {
    return expressionCouldBeNullish(body);
  }
  let nullable = false;
  const visit = (node: ts.Node): void => {
    if (nullable) return;
    if (ts.isReturnStatement(node)) {
      if (!node.expression || expressionCouldBeNullish(node.expression)) {
        nullable = true;
      }
      return;
    }
    if (ts.isFunctionLike(node) && node !== (body as unknown as ts.Node)) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return nullable;
}

function collectPreconditions(
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
  sourceFile: ts.SourceFile,
): string[] {
  if (!ts.isBlock(body)) {
    return [];
  }
  const parameterNames = parameters
    .map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : undefined))
    .filter((name): name is string => Boolean(name));
  if (parameterNames.length === 0) {
    return [];
  }

  const preconditions = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const conditionText = normalizeWhitespace(node.expression.getText(sourceFile));
      if (hasThrow(node.thenStatement)) {
        for (const parameterName of parameterNames) {
          if (new RegExp(`\\b${parameterName}\\b`).test(conditionText)) {
            preconditions.add(`${parameterName} must be provided`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return uniqueSorted(preconditions);
}

function makeBehaviorSummary(fn: {
  calls: string[];
  returnsNullable: boolean;
  preconditions: string[];
}): string {
  const callsPart = fn.calls.length > 0 ? fn.calls.join(', ') : 'none';
  const preconditionsPart = fn.preconditions.length > 0 ? fn.preconditions.join('; ') : 'none';
  return `returns=${fn.returnsNullable ? 'nullable' : 'non-null'}; calls=[${callsPart}]; preconditions=[${preconditionsPart}]`;
}

function pushParsedFunction(
  functions: ParsedFunction[],
  filePath: string,
  name: string,
  node: ts.Node,
  body: ts.ConciseBody | undefined,
  sourceFile: ts.SourceFile,
  parameters: readonly ts.ParameterDeclaration[],
): void {
  if (!body) {
    return;
  }
  const calls = collectCalls(body, sourceFile);
  const returnsNullable = collectReturnsNullable(body);
  const preconditions = collectPreconditions(body, parameters, sourceFile);
  const normalizedBody = normalizeWhitespace(body.getText(sourceFile));
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const behaviorSummary = makeBehaviorSummary({ calls, returnsNullable, preconditions });
  functions.push({
    id: `${filePath}:${name}` as FunctionId,
    name,
    filePath,
    normalizedBody,
    behaviorSummary,
    calls,
    returnsNullable,
    preconditions,
    startLine,
  });
}

function parseFunctionsFromSource(filePath: string, content: string): ParsedFunction[] {
  if (!isSourceFilePath(filePath)) {
    return [];
  }
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const functions: ParsedFunction[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushParsedFunction(
        functions,
        filePath,
        node.name.text,
        node,
        node.body,
        sourceFile,
        node.parameters,
      );
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          pushParsedFunction(
            functions,
            filePath,
            declaration.name.text,
            declaration,
            declaration.initializer.body,
            sourceFile,
            declaration.initializer.parameters,
          );
        }
      }
    }

    if (ts.isMethodDeclaration(node) && node.body) {
      const classNode = node.parent;
      const className =
        ts.isClassLike(classNode) && classNode.name
          ? classNode.name.text
          : 'AnonymousClass';
      pushParsedFunction(
        functions,
        filePath,
        `${className}.${readNodeName(node.name, sourceFile)}`,
        node,
        node.body,
        sourceFile,
        node.parameters,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  });
  return String(stdout);
}

async function tryGitShow(cwd: string, sha: string, filePath: string): Promise<string | null> {
  try {
    const output = await runGit(['show', `${sha}:${filePath}`], cwd);
    return output;
  } catch {
    return null;
  }
}

async function tryReadWorkingTreeFile(workspaceRoot: string, filePath: string): Promise<string | null> {
  const absolute = path.resolve(workspaceRoot, filePath);
  try {
    return await readFile(absolute, 'utf8');
  } catch {
    return null;
  }
}

function extractDiffFilePairs(diff: string): DiffFilePair[] {
  const blocks = diff.split(/^diff --git /m).slice(1);
  const pairs: DiffFilePair[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0] ?? '';
    const headerMatch = header.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) {
      continue;
    }

    const renameFrom = block.match(/^rename from (.+)$/m)?.[1]?.trim();
    const renameTo = block.match(/^rename to (.+)$/m)?.[1]?.trim();

    const oldPath = normalizePath(renameFrom ?? headerMatch[1]);
    const newPath = normalizePath(renameTo ?? headerMatch[2]);

    pairs.push({
      oldPath: oldPath === 'dev/null' ? undefined : oldPath,
      newPath: newPath === 'dev/null' ? undefined : newPath,
    });
  }

  return pairs;
}

async function resolveDiff(input: DiffSummarizerInput, workspaceRoot: string): Promise<string> {
  if (input.diff && input.diff.trim().length > 0) {
    return input.diff;
  }
  if (!input.baseSha || !input.headSha) {
    throw new ConstructionError(
      'diff-semantic-summarizer requires diff or both baseSha/headSha',
      'diff-semantic-summarizer',
    );
  }
  return runGit(['diff', '--unified=3', input.baseSha, input.headSha], workspaceRoot);
}

async function loadSnapshotFunctions(
  input: DiffSummarizerInput,
  workspaceRoot: string,
  diff: string,
): Promise<SnapshotFunctionSets> {
  const pairs = extractDiffFilePairs(diff);
  const beforeFunctions: ParsedFunction[] = [];
  const afterFunctions: ParsedFunction[] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const pairKey = `${pair.oldPath ?? '<none>'}->${pair.newPath ?? '<none>'}`;
    if (seen.has(pairKey)) {
      continue;
    }
    seen.add(pairKey);

    if (pair.oldPath) {
      const beforeText = input.baseSha
        ? await tryGitShow(workspaceRoot, input.baseSha, pair.oldPath)
        : null;
      if (beforeText !== null) {
        beforeFunctions.push(...parseFunctionsFromSource(pair.oldPath, beforeText));
      }
    }

    if (pair.newPath) {
      const afterText = input.headSha
        ? await tryGitShow(workspaceRoot, input.headSha, pair.newPath)
        : await tryReadWorkingTreeFile(workspaceRoot, pair.newPath);
      if (afterText !== null) {
        afterFunctions.push(...parseFunctionsFromSource(pair.newPath, afterText));
      }
    }
  }

  return { before: beforeFunctions, after: afterFunctions };
}

function contractChangesFor(
  beforeFn: ParsedFunction | null,
  afterFn: ParsedFunction | null,
): FunctionSemanticDelta['contractChanges'] {
  if (!beforeFn || !afterFn) {
    return {
      weakenedPostconditions: [],
      newPreconditions: [],
      removedGuarantees: [],
    };
  }

  const weakenedPostconditions: string[] = [];
  const removedGuarantees: string[] = [];
  if (!beforeFn.returnsNullable && afterFn.returnsNullable) {
    weakenedPostconditions.push('return value is never null');
    removedGuarantees.push('return value is never null');
  }

  const beforePreconditions = new Set(beforeFn.preconditions);
  const newPreconditions = afterFn.preconditions.filter((precondition) => !beforePreconditions.has(precondition));

  return {
    weakenedPostconditions,
    newPreconditions,
    removedGuarantees,
  };
}

function inferRiskLevel(
  changeKind: FunctionSemanticDelta['changeKind'],
  contractChanges: FunctionSemanticDelta['contractChanges'],
): FunctionSemanticDelta['riskLevel'] {
  if (contractChanges.weakenedPostconditions.length > 0 || contractChanges.removedGuarantees.length > 0) {
    return 'high';
  }
  if (contractChanges.newPreconditions.length > 0 || changeKind === 'deleted') {
    return 'medium';
  }
  return 'low';
}

function riskRank(risk: FunctionSemanticDelta['riskLevel']): number {
  switch (risk) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
      return 2;
    default:
      return 3;
  }
}

function computeCallerImpact(
  allAfterFunctions: ParsedFunction[],
  delta: FunctionSemanticDelta,
): CallerImpact {
  const byId = new Map<FunctionId, ParsedFunction>();
  const idsByName = new Map<string, Set<FunctionId>>();

  for (const fn of allAfterFunctions) {
    byId.set(fn.id, fn);
    const existing = idsByName.get(fn.name) ?? new Set<FunctionId>();
    existing.add(fn.id);
    idsByName.set(fn.name, existing);
  }

  const forward = new Map<FunctionId, Set<FunctionId>>();
  const reverse = new Map<FunctionId, Set<FunctionId>>();

  for (const fn of allAfterFunctions) {
    const calleeIds = new Set<FunctionId>();
    for (const callName of fn.calls) {
      const targets = idsByName.get(callName);
      if (!targets) continue;
      for (const targetId of targets) {
        calleeIds.add(targetId);
      }
    }
    forward.set(fn.id, calleeIds);
  }

  for (const [callerId, calleeIds] of forward) {
    for (const calleeId of calleeIds) {
      const callers = reverse.get(calleeId) ?? new Set<FunctionId>();
      callers.add(callerId);
      reverse.set(calleeId, callers);
    }
  }

  const targetIds = idsByName.get(delta.name) ?? new Set<FunctionId>();
  const direct = new Set<FunctionId>();
  for (const targetId of targetIds) {
    const callers = reverse.get(targetId);
    if (!callers) continue;
    for (const caller of callers) {
      direct.add(caller);
    }
  }

  const transitive = new Set<FunctionId>();
  const queue: FunctionId[] = Array.from(direct);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const upstream = reverse.get(current);
    if (!upstream) continue;
    for (const caller of upstream) {
      if (direct.has(caller) || transitive.has(caller)) {
        continue;
      }
      transitive.add(caller);
      queue.push(caller);
    }
  }

  const affected = new Set<FunctionId>([...direct, ...transitive]);
  return { direct, transitive, affected };
}

function formatCoverageGap(delta: FunctionSemanticDelta): string {
  return `${delta.filePath}:${delta.name}`;
}

function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return `${words.slice(0, maxWords).join(' ')} ...[truncated]`;
}

function buildAgentBriefing(
  deltas: FunctionSemanticDelta[],
  blastRadius: DiffSemanticSummarizerOutput['blastRadius'],
  coverageGaps: DiffSemanticSummarizerOutput['newCoverageGaps'],
): string {
  const lines: string[] = [
    `Semantic diff summary: ${deltas.length} changed functions.`,
    `Blast radius: directCallers=${blastRadius.directCallers}, transitiveCallers=${blastRadius.transitiveCallers}, blastScore=${blastRadius.blastScore}.`,
    `Coverage gaps introduced: ${coverageGaps.length}.`,
  ];

  const sorted = [...deltas].sort((a, b) => {
    const riskCompare = riskRank(a.riskLevel) - riskRank(b.riskLevel);
    if (riskCompare !== 0) return riskCompare;
    return a.name.localeCompare(b.name);
  });

  for (const delta of sorted.slice(0, 24)) {
    const weakened = delta.contractChanges.weakenedPostconditions.join(', ') || 'none';
    const preconditions = delta.contractChanges.newPreconditions.join(', ') || 'none';
    lines.push(
      [
        `- [${delta.riskLevel}] ${delta.changeKind} ${delta.filePath}:${delta.name}`,
        `weakened=${weakened}`,
        `newPreconditions=${preconditions}`,
        `affectedCallers=${delta.affectedCallers.length}`,
        `coverage=${delta.coverageDelta.previouslyCovered ? 'covered' : 'uncovered'}→${delta.coverageDelta.nowCovered ? 'covered' : 'uncovered'}`,
      ].join(' | '),
    );
  }

  return limitWords(lines.join('\n'), MAX_BRIEFING_WORDS);
}

function buildReviewerSummary(
  deltas: FunctionSemanticDelta[],
  blastRadius: DiffSemanticSummarizerOutput['blastRadius'],
): string {
  const highRisk = deltas.filter((delta) => delta.riskLevel === 'high');
  const extracted = deltas.filter((delta) => delta.changeKind === 'extracted');
  const renamed = deltas.filter((delta) => delta.changeKind === 'renamed');
  const weakened = deltas.filter((delta) => delta.contractChanges.weakenedPostconditions.length > 0);
  const extractionLine = extracted.length > 0
    ? `${extracted.length} helper extraction(s) detected; extraction faithfulness was validated when parent semantics still contained extracted logic.`
    : 'No helper extraction patterns were detected.';

  return [
    `Behavioral summary: ${deltas.length} function-level semantic changes (${highRisk.length} high risk).`,
    `Contract impact: ${weakened.length} changes weakened postconditions; renamed-only changes=${renamed.length}.`,
    `Blast radius: direct=${blastRadius.directCallers}, transitive=${blastRadius.transitiveCallers}, score=${blastRadius.blastScore}.`,
    extractionLine,
  ].join(' ');
}

async function listTestFilesInGitSnapshot(workspaceRoot: string, sha: string): Promise<string[]> {
  let listed: string;
  try {
    listed = await runGit(['ls-tree', '-r', '--name-only', sha], workspaceRoot);
  } catch {
    return [];
  }
  return listed
    .split('\n')
    .map((entry) => normalizePath(entry.trim()))
    .filter((entry) => entry.length > 0 && TEST_FILE_PATTERN.test(entry));
}

async function listTestFilesInWorkingTree(workspaceRoot: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === '.git' || entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      const absolute = path.join(currentPath, entry);
      const relative = normalizePath(path.relative(workspaceRoot, absolute));
      try {
        const stat = await readFile(absolute, 'utf8')
          .then(() => 'file' as const)
          .catch(async () => {
            const nested = await readdir(absolute);
            return nested ? 'dir' as const : 'file' as const;
          });

        if (stat === 'file') {
          if (TEST_FILE_PATTERN.test(relative)) {
            output.push(relative);
          }
          continue;
        }
      } catch {
        continue;
      }
      await walk(absolute);
    }
  }

  await walk(workspaceRoot);
  return uniqueSorted(output);
}

async function loadTestSnapshotContents(
  workspaceRoot: string,
  sha?: string,
): Promise<string[]> {
  const testFiles = sha
    ? await listTestFilesInGitSnapshot(workspaceRoot, sha)
    : await listTestFilesInWorkingTree(workspaceRoot);
  if (testFiles.length === 0) {
    return [];
  }

  const contents: string[] = [];
  for (const testFilePath of testFiles) {
    const content = sha
      ? await tryGitShow(workspaceRoot, sha, testFilePath)
      : await tryReadWorkingTreeFile(workspaceRoot, testFilePath);
    if (content !== null) {
      contents.push(content);
    }
  }
  return contents;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testCoverageByName(name: string, testContents: string[]): boolean {
  if (testContents.length === 0 || name.trim().length === 0) {
    return false;
  }
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  return testContents.some((content) => pattern.test(content));
}

function sameContracts(a: ParsedFunction, b: ParsedFunction): boolean {
  if (a.returnsNullable !== b.returnsNullable) return false;
  if (a.preconditions.length !== b.preconditions.length) return false;
  for (let i = 0; i < a.preconditions.length; i += 1) {
    if (a.preconditions[i] !== b.preconditions[i]) {
      return false;
    }
  }
  return true;
}

function sameCalls(a: ParsedFunction, b: ParsedFunction): boolean {
  if (a.calls.length !== b.calls.length) return false;
  for (let i = 0; i < a.calls.length; i += 1) {
    if (a.calls[i] !== b.calls[i]) {
      return false;
    }
  }
  return true;
}

async function summarizeDiff(input: DiffSummarizerInput): Promise<DiffSemanticSummarizerOutput> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const diff = await resolveDiff(input, workspaceRoot);
  const parsedDiff = parseUnifiedDiff(diff);
  if (parsedDiff.length === 0) {
    return {
      deltas: [],
      blastRadius: { directCallers: 0, transitiveCallers: 0, blastScore: 0 },
      criticalChanges: [],
      newCoverageGaps: [],
      agentBriefing: 'Semantic diff summary: no changed functions detected from the supplied diff.',
      reviewerSummary: 'No semantic function deltas were detected.',
    };
  }

  const snapshots = await loadSnapshotFunctions(input, workspaceRoot, diff);
  const beforeByKey = new Map<string, ParsedFunction>();
  for (const fn of snapshots.before) {
    beforeByKey.set(toKey(fn.filePath, fn.name), fn);
  }
  const afterByKey = new Map<string, ParsedFunction>();
  for (const fn of snapshots.after) {
    afterByKey.set(toKey(fn.filePath, fn.name), fn);
  }

  const matchedBefore = new Set<string>();
  const matchedAfter = new Set<string>();
  const deltas: FunctionSemanticDelta[] = [];
  const modifiedPairs: Array<{ before: ParsedFunction; after: ParsedFunction }> = [];
  const extractionEvidenceById = new Map<FunctionId, ExtractionEvidence>();

  for (const [key, afterFn] of afterByKey) {
    const beforeFn = beforeByKey.get(key);
    if (!beforeFn) {
      continue;
    }
    matchedBefore.add(key);
    matchedAfter.add(key);
    const changed =
      beforeFn.normalizedBody !== afterFn.normalizedBody ||
      !sameContracts(beforeFn, afterFn) ||
      !sameCalls(beforeFn, afterFn);
    if (!changed) {
      continue;
    }
    modifiedPairs.push({ before: beforeFn, after: afterFn });
    const contracts = contractChangesFor(beforeFn, afterFn);
    deltas.push({
      functionId: afterFn.id,
      name: afterFn.name,
      filePath: afterFn.filePath,
      changeKind: 'modified',
      behaviorBefore: beforeFn.behaviorSummary,
      behaviorAfter: afterFn.behaviorSummary,
      contractChanges: contracts,
      affectedCallers: [],
      coverageDelta: { previouslyCovered: false, nowCovered: false },
      riskLevel: inferRiskLevel('modified', contracts),
    });
  }

  const removed = Array.from(beforeByKey.entries())
    .filter(([key]) => !matchedBefore.has(key))
    .map(([, value]) => value);
  const added = Array.from(afterByKey.entries())
    .filter(([key]) => !matchedAfter.has(key))
    .map(([, value]) => value);

  const consumedRemoved = new Set<FunctionId>();
  const consumedAdded = new Set<FunctionId>();

  for (const removedFn of removed) {
    let matchedIndex = -1;
    for (let i = 0; i < added.length; i += 1) {
      const addedFn = added[i];
      if (consumedAdded.has(addedFn.id)) continue;
      if (removedFn.normalizedBody.length === 0 || addedFn.normalizedBody.length === 0) continue;
      if (removedFn.normalizedBody !== addedFn.normalizedBody) continue;
      if (!sameContracts(removedFn, addedFn) || !sameCalls(removedFn, addedFn)) continue;
      matchedIndex = i;
      break;
    }
    if (matchedIndex < 0) {
      continue;
    }
    const renamedFn = added[matchedIndex];
    consumedRemoved.add(removedFn.id);
    consumedAdded.add(renamedFn.id);
    deltas.push({
      functionId: renamedFn.id,
      name: renamedFn.name,
      filePath: renamedFn.filePath,
      changeKind: 'renamed',
      behaviorBefore: removedFn.behaviorSummary,
      behaviorAfter: renamedFn.behaviorSummary,
      contractChanges: {
        weakenedPostconditions: [],
        newPreconditions: [],
        removedGuarantees: [],
      },
      affectedCallers: [],
      coverageDelta: { previouslyCovered: false, nowCovered: false },
      riskLevel: 'low',
    });
  }

  for (const addedFn of added) {
    if (consumedAdded.has(addedFn.id)) {
      continue;
    }
    const addedTokens = tokenize(addedFn.normalizedBody);
    let extractionFrom: ParsedFunction | null = null;
    let faithful = false;
    for (const pair of modifiedPairs) {
      if (!pair.after.calls.includes(addedFn.name)) {
        continue;
      }
      const beforeBodyContainsExtracted =
        addedFn.normalizedBody.length > 0 &&
        pair.before.normalizedBody.includes(addedFn.normalizedBody);
      const beforeSimilarity = jaccardSimilarity(addedTokens, tokenize(pair.before.normalizedBody));
      const afterSimilarity = jaccardSimilarity(addedTokens, tokenize(pair.after.normalizedBody));
      const extractionByDeltaShape =
        beforeSimilarity >= 0.45 &&
        beforeSimilarity > afterSimilarity + 0.12;
      if (beforeBodyContainsExtracted || beforeSimilarity >= 0.62 || extractionByDeltaShape) {
        extractionFrom = pair.after;
        faithful =
          beforeBodyContainsExtracted ||
          beforeSimilarity >= 0.75 ||
          (beforeSimilarity >= 0.6 && beforeSimilarity > afterSimilarity + 0.2);
        break;
      }
    }

    if (extractionFrom) {
      consumedAdded.add(addedFn.id);
      extractionEvidenceById.set(addedFn.id, {
        parentName: extractionFrom.name,
        faithful,
      });
      deltas.push({
        functionId: addedFn.id,
        name: addedFn.name,
        filePath: addedFn.filePath,
        changeKind: 'extracted',
        behaviorBefore: null,
        behaviorAfter: `${addedFn.behaviorSummary}; extractedFrom=${extractionFrom.name}; faithful=${faithful ? 'yes' : 'no'}`,
        contractChanges: {
          weakenedPostconditions: [],
          newPreconditions: [],
          removedGuarantees: [],
        },
        affectedCallers: [],
        coverageDelta: { previouslyCovered: false, nowCovered: false },
        riskLevel: faithful ? 'low' : 'medium',
      });
      continue;
    }

    deltas.push({
      functionId: addedFn.id,
      name: addedFn.name,
      filePath: addedFn.filePath,
      changeKind: 'added',
      behaviorBefore: null,
      behaviorAfter: addedFn.behaviorSummary,
      contractChanges: {
        weakenedPostconditions: [],
        newPreconditions: [],
        removedGuarantees: [],
      },
      affectedCallers: [],
      coverageDelta: { previouslyCovered: false, nowCovered: false },
      riskLevel: 'low',
    });
  }

  for (const removedFn of removed) {
    if (consumedRemoved.has(removedFn.id)) {
      continue;
    }
    deltas.push({
      functionId: removedFn.id,
      name: removedFn.name,
      filePath: removedFn.filePath,
      changeKind: 'deleted',
      behaviorBefore: removedFn.behaviorSummary,
      behaviorAfter: null,
      contractChanges: {
        weakenedPostconditions: [],
        newPreconditions: [],
        removedGuarantees: [],
      },
      affectedCallers: [],
      coverageDelta: { previouslyCovered: false, nowCovered: false },
      riskLevel: 'medium',
    });
  }

  const baseTests = await loadTestSnapshotContents(workspaceRoot, input.baseSha);
  const headTests = await loadTestSnapshotContents(workspaceRoot, input.headSha);

  let directCallers = new Set<FunctionId>();
  let transitiveCallers = new Set<FunctionId>();
  const newCoverageGaps: Array<{ functionId: FunctionId; uncoveredPaths: string[] }> = [];

  for (const delta of deltas) {
    const callers = computeCallerImpact(snapshots.after, delta);
    directCallers = new Set([...directCallers, ...callers.direct]);
    transitiveCallers = new Set([...transitiveCallers, ...callers.transitive]);
    delta.affectedCallers = uniqueSorted(callers.affected);

    const previouslyCovered = testCoverageByName(delta.name, baseTests);
    const nowCovered = testCoverageByName(delta.name, headTests);
    delta.coverageDelta = { previouslyCovered, nowCovered };

    if (!nowCovered) {
      newCoverageGaps.push({
        functionId: delta.functionId,
        uncoveredPaths: [formatCoverageGap(delta)],
      });
      if (delta.riskLevel === 'low') {
        delta.riskLevel = previouslyCovered ? 'medium' : 'low';
      }
    }
  }

  for (const delta of deltas) {
    if (delta.riskLevel === 'medium' && delta.affectedCallers.length >= 4) {
      delta.riskLevel = 'high';
    }
    if (delta.riskLevel === 'low' && delta.affectedCallers.length >= 2) {
      delta.riskLevel = 'medium';
    }
  }

  for (const delta of deltas) {
    const evidence = extractionEvidenceById.get(delta.functionId);
    if (!evidence || delta.behaviorAfter === null) {
      continue;
    }
    delta.behaviorAfter = `${delta.behaviorAfter}; extractionFaithfulness=${evidence.faithful ? 'validated' : 'unverified'}`;
  }

  const transitiveOnly = new Set<FunctionId>();
  for (const caller of transitiveCallers) {
    if (!directCallers.has(caller)) {
      transitiveOnly.add(caller);
    }
  }

  const blastRadius = {
    directCallers: directCallers.size,
    transitiveCallers: transitiveOnly.size,
    blastScore: Math.round((directCallers.size + transitiveOnly.size * 0.5) * 100) / 100,
  };

  deltas.sort((a, b) => {
    const riskCompare = riskRank(a.riskLevel) - riskRank(b.riskLevel);
    if (riskCompare !== 0) return riskCompare;
    const kindCompare = a.changeKind.localeCompare(b.changeKind);
    if (kindCompare !== 0) return kindCompare;
    const fileCompare = a.filePath.localeCompare(b.filePath);
    if (fileCompare !== 0) return fileCompare;
    return a.name.localeCompare(b.name);
  });

  const criticalChanges = deltas
    .filter((delta) => delta.riskLevel === 'high')
    .slice(0, 12);

  const agentBriefing = buildAgentBriefing(deltas, blastRadius, newCoverageGaps);
  const reviewerSummary = buildReviewerSummary(deltas, blastRadius);

  return {
    deltas,
    blastRadius,
    criticalChanges,
    newCoverageGaps,
    agentBriefing,
    reviewerSummary,
  };
}

export function createDiffSemanticSummarizerConstruction(): Construction<
  DiffSummarizerInput,
  DiffSemanticSummarizerOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'diff-semantic-summarizer',
    name: 'Diff Semantic Summarizer',
    description:
      'Compares pre/post diff semantics to report behavioral deltas, contract changes, blast radius, and coverage impact.',
    async execute(input: DiffSummarizerInput) {
      if (
        (!input.diff || input.diff.trim().length === 0) &&
        (!input.baseSha || input.baseSha.trim().length === 0 || !input.headSha || input.headSha.trim().length === 0)
      ) {
        throw new ConstructionError(
          'diff-semantic-summarizer requires either diff or both baseSha/headSha',
          'diff-semantic-summarizer',
        );
      }
      const output = await summarizeDiff(input);
      return ok<DiffSemanticSummarizerOutput, ConstructionError>(output);
    },
  };
}
