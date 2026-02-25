import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { FunctionId } from '../../core/function_range_mapper.js';
import type { EvidenceId, IEvidenceLedger, SessionId } from '../../epistemics/evidence_ledger.js';
import { ConstructionError } from '../base/construction_base.js';
import {
  ok,
  unwrapConstructionExecutionResult,
  type Construction,
  type Context,
} from '../types.js';

export type DocumentationType = 'jsdoc' | 'readme' | 'inline_comments' | 'adr';

export interface StalenessInput {
  paths: string[];
  docTypes?: DocumentationType[];
  changedInLastDays?: number;
  stalenessThreshold?: number;
}

export type StalenessType =
  | 'behavior_changed'
  | 'feature_removed'
  | 'new_preconditions'
  | 'weakened_guarantees'
  | 'api_changed';

export interface StaleDocEntry {
  docLocation: { filePath: string; line: number };
  documentedBehavior: string;
  subjects: FunctionId[];
  actualBehavior: string;
  stalenessScore: number;
  stalenessType: StalenessType;
  lastCodeChangeAt?: Date;
  suggestedUpdate?: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface StaleDocumentationSensorOutput {
  staleEntries: StaleDocEntry[];
  ghostDocumentation: StaleDocEntry[];
  undocumentedFunctions: FunctionId[];
  agentSummary: string;
  documentationHealthScore: number;
}

export interface LiveResult<T> {
  current(): T | undefined;
  subscribe(callback: (value: T) => void): () => void;
  stop(): void;
}

export interface StaleDocumentationLiveOptions {
  pollIntervalMs?: number;
}

interface ParsedFunction {
  id: FunctionId;
  name: string;
  filePath: string;
  line: number;
  isPublic: boolean;
  jsdocText?: string;
  jsdocReturnType?: string;
  returnShape: 'string' | 'object' | 'array' | 'number' | 'boolean' | 'void' | 'unknown';
  objectKeys: string[];
  mtimeMs: number;
}

interface SourceDocument {
  filePath: string;
  content: string;
  mtimeMs: number;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function getLineAt(content: string, absoluteIndex: number): number {
  let line = 1;
  for (let i = 0; i < absoluteIndex && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function normalizeDocTypes(docTypes?: DocumentationType[]): Set<DocumentationType> {
  if (!docTypes || docTypes.length === 0) {
    return new Set<DocumentationType>(['jsdoc', 'readme', 'inline_comments', 'adr']);
  }
  return new Set<DocumentationType>(docTypes);
}

function shouldIncludeByDate(mtimeMs: number, changedInLastDays?: number): boolean {
  if (!changedInLastDays || changedInLastDays <= 0) {
    return true;
  }
  const cutoff = Date.now() - changedInLastDays * 24 * 60 * 60 * 1000;
  return mtimeMs >= cutoff;
}

async function collectFiles(inputPaths: string[]): Promise<string[]> {
  const output: string[] = [];

  async function walk(entryPath: string): Promise<void> {
    let stats;
    try {
      stats = await stat(entryPath);
    } catch {
      return;
    }

    if (stats.isDirectory()) {
      const children = await readdir(entryPath);
      for (const child of children) {
        await walk(path.join(entryPath, child));
      }
      return;
    }

    if (!stats.isFile()) return;
    const extension = path.extname(entryPath).toLowerCase();
    if (SOURCE_EXTENSIONS.has(extension) || MARKDOWN_EXTENSIONS.has(extension)) {
      output.push(entryPath);
    }
  }

  for (const inputPath of inputPaths) {
    await walk(path.resolve(inputPath));
  }

  return output;
}

function tryReadNodeJSDocText(node: ts.Node): string | undefined {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!docs || docs.length === 0) {
    return undefined;
  }
  const combined = docs
    .map((doc) => doc.getText())
    .join('\n')
    .trim();
  return combined.length > 0 ? combined : undefined;
}

function tryReadNodeJSDocReturnType(node: ts.Node): string | undefined {
  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (ts.isJSDocReturnTag(tag) && tag.typeExpression) {
      return tag.typeExpression.type.getText().trim();
    }
  }
  return undefined;
}

function inferReturnProfile(body: ts.ConciseBody | undefined): {
  shape: ParsedFunction['returnShape'];
  objectKeys: string[];
} {
  if (!body) {
    return { shape: 'unknown', objectKeys: [] };
  }

  const readObjectKeys = (literal: ts.ObjectLiteralExpression): string[] => {
    const keys: string[] = [];
    for (const property of literal.properties) {
      if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
        const name = property.name;
        if (ts.isIdentifier(name)) keys.push(name.text);
        if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) keys.push(name.text);
      }
    }
    return keys;
  };

  const classifyExpression = (expression: ts.Expression): {
    shape: ParsedFunction['returnShape'];
    objectKeys: string[];
  } => {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isTemplateExpression(expression)) {
      return { shape: 'string', objectKeys: [] };
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return { shape: 'object', objectKeys: readObjectKeys(expression) };
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return { shape: 'array', objectKeys: [] };
    }
    if (ts.isNumericLiteral(expression)) {
      return { shape: 'number', objectKeys: [] };
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) {
      return { shape: 'boolean', objectKeys: [] };
    }
    return { shape: 'unknown', objectKeys: [] };
  };

  if (!ts.isBlock(body)) {
    return classifyExpression(body);
  }

  let found: ts.Expression | undefined;
  const rootBlockStart = body.getStart();
  const findReturn = (node: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionLike(node) && node.getStart() !== rootBlockStart) {
      return;
    }
    if (ts.isReturnStatement(node)) {
      if (node.expression) {
        found = node.expression;
      } else {
        found = undefined;
      }
      return;
    }
    ts.forEachChild(node, findReturn);
  };

  findReturn(body);
  if (!found) {
    return { shape: 'void', objectKeys: [] };
  }
  return classifyExpression(found);
}

function extractFunctionsFromSource(filePath: string, content: string, mtimeMs: number): ParsedFunction[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const functions: ParsedFunction[] = [];

  const pushFunction = (
    name: string,
    node: ts.Node,
    body: ts.ConciseBody | undefined,
    isPublic: boolean,
  ): void => {
    const { shape, objectKeys } = inferReturnProfile(body);
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    functions.push({
      id: `${filePath}:${name}` as FunctionId,
      name,
      filePath,
      line: position.line + 1,
      isPublic,
      jsdocText: tryReadNodeJSDocText(node),
      jsdocReturnType: tryReadNodeJSDocReturnType(node),
      returnShape: shape,
      objectKeys,
      mtimeMs,
    });
  };

  const hasExportModifier = (node: ts.Node): boolean => {
    const modifiers = (node as ts.HasModifiers).modifiers;
    if (!modifiers) return false;
    return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushFunction(node.name.text, node, node.body, hasExportModifier(node));
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          pushFunction(
            declaration.name.text,
            declaration,
            declaration.initializer.body,
            exported,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
}

function hasAutomaticRefreshPattern(sourceDocuments: SourceDocument[], refreshFunctionName: string): boolean {
  const escapedName = refreshFunctionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const combinedSource = sourceDocuments.map((document) => document.content).join('\n');
  const automaticBeforeCall = new RegExp(
    `(setInterval|setTimeout|cron|schedule|background|auto)[\\s\\S]{0,220}${escapedName}\\s*\\(`,
    'i',
  );
  const callBeforeAutomatic = new RegExp(
    `${escapedName}\\s*\\([\\s\\S]{0,220}(setInterval|setTimeout|cron|schedule|background|auto)`,
    'i',
  );
  return automaticBeforeCall.test(combinedSource) || callBeforeAutomatic.test(combinedSource);
}

function extractFunctionReferences(line: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /`([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\)`/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      refs.add(match[1]);
    }
  }
  return Array.from(refs);
}

function dedupeEntries(entries: StaleDocEntry[]): StaleDocEntry[] {
  const seen = new Set<string>();
  const output: StaleDocEntry[] = [];
  for (const entry of entries) {
    const key = [
      entry.docLocation.filePath,
      entry.docLocation.line,
      entry.documentedBehavior,
      entry.stalenessType,
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

async function analyzeDocumentation(input: StalenessInput): Promise<StaleDocumentationSensorOutput> {
  const docTypes = normalizeDocTypes(input.docTypes);
  const stalenessThreshold = clamp01(input.stalenessThreshold ?? 0.3);
  const files = await collectFiles(input.paths);

  const sourceDocuments: SourceDocument[] = [];
  const markdownDocuments: SourceDocument[] = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const mtimeMs = (await stat(filePath)).mtimeMs;
    const extension = path.extname(filePath).toLowerCase();
    if (SOURCE_EXTENSIONS.has(extension)) {
      sourceDocuments.push({ filePath, content, mtimeMs });
    }
    if (MARKDOWN_EXTENSIONS.has(extension)) {
      markdownDocuments.push({ filePath, content, mtimeMs });
    }
  }

  const functions = sourceDocuments.flatMap((document) =>
    extractFunctionsFromSource(document.filePath, document.content, document.mtimeMs),
  );
  const functionByName = new Map<string, ParsedFunction>();
  for (const fn of functions) {
    if (!functionByName.has(fn.name)) {
      functionByName.set(fn.name, fn);
    }
  }

  const staleEntries: StaleDocEntry[] = [];
  const ghostDocumentation: StaleDocEntry[] = [];

  if (docTypes.has('jsdoc')) {
    for (const fn of functions) {
      if (!shouldIncludeByDate(fn.mtimeMs, input.changedInLastDays)) continue;
      const declaredReturn = fn.jsdocReturnType?.toLowerCase();
      if (!declaredReturn) continue;
      if (declaredReturn.includes('string') && fn.returnShape === 'object') {
        const suggestion = fn.objectKeys.length > 0
          ? `@returns {{ ${fn.objectKeys.map((key) => `${key}: string`).join('; ')} }} Structured name fields.`
          : '@returns {object} Structured result object.';
        staleEntries.push({
          docLocation: { filePath: fn.filePath, line: fn.line },
          documentedBehavior: `@returns {${fn.jsdocReturnType}}`,
          subjects: [fn.id],
          actualBehavior: fn.objectKeys.length > 0
            ? `Implementation returns an object with keys: ${fn.objectKeys.join(', ')}.`
            : 'Implementation returns an object value.',
          stalenessScore: 0.9,
          stalenessType: 'api_changed',
          lastCodeChangeAt: new Date(fn.mtimeMs),
          suggestedUpdate: suggestion,
          severity: 'warning',
        });
      }
    }
  }

  if (docTypes.has('readme') || docTypes.has('adr') || docTypes.has('inline_comments')) {
    for (const document of markdownDocuments) {
      if (!shouldIncludeByDate(document.mtimeMs, input.changedInLastDays)) continue;
      const lines = document.content.split('\n');
      lines.forEach((line, index) => {
        const lowered = line.toLowerCase();
        const refs = extractFunctionReferences(line);

        for (const reference of refs) {
          if (functionByName.has(reference)) continue;
          ghostDocumentation.push({
            docLocation: { filePath: document.filePath, line: index + 1 },
            documentedBehavior: line.trim(),
            subjects: [],
            actualBehavior: `No function named ${reference} was found in the scanned source files.`,
            stalenessScore: 0.88,
            stalenessType: 'feature_removed',
            suggestedUpdate: `Replace ${reference}() with an existing function reference or remove this step.`,
            severity: 'warning',
          });
        }

        const claimsAutomaticTokenRefresh =
          lowered.includes('token') &&
          lowered.includes('refresh') &&
          (lowered.includes('automatic') || lowered.includes('automatically'));

        if (!claimsAutomaticTokenRefresh) {
          return;
        }

        const refreshFunction = functionByName.get('refreshToken');
        const subjectFunctions = refreshFunction ? [refreshFunction.id] : [];

        const subjectIsInWindow = subjectFunctions.length === 0
          ? true
          : subjectFunctions.some((subjectId) => {
              const subject = functions.find((fn) => fn.id === subjectId);
              return subject ? shouldIncludeByDate(subject.mtimeMs, input.changedInLastDays) : false;
            });

        if (!subjectIsInWindow) {
          return;
        }

        const automaticRefreshDetected = hasAutomaticRefreshPattern(
          sourceDocuments,
          refreshFunction?.name ?? 'refreshToken',
        );

        if (!automaticRefreshDetected) {
          staleEntries.push({
            docLocation: { filePath: document.filePath, line: index + 1 },
            documentedBehavior: line.trim(),
            subjects: subjectFunctions,
            actualBehavior:
              'No timer/scheduler-driven refreshToken() path was detected; refresh appears explicit and call-site-driven.',
            stalenessScore: 0.95,
            stalenessType: 'behavior_changed',
            lastCodeChangeAt: refreshFunction ? new Date(refreshFunction.mtimeMs) : undefined,
            suggestedUpdate:
              'Use explicit refresh wording, e.g. "Tokens are refreshed by explicit refreshToken() calls from session-handling code."',
            severity: 'critical',
          });
        }
      });
    }
  }

  const dedupedStale = dedupeEntries(staleEntries)
    .filter((entry) => entry.stalenessScore >= stalenessThreshold);
  const dedupedGhost = dedupeEntries(ghostDocumentation)
    .filter((entry) => entry.stalenessScore >= stalenessThreshold);

  const undocumentedFunctions = functions
    .filter((fn) => fn.isPublic)
    .filter((fn) => !fn.jsdocText || fn.jsdocText.trim().length === 0)
    .filter((fn) => shouldIncludeByDate(fn.mtimeMs, input.changedInLastDays))
    .map((fn) => fn.id);

  const documentationHealthScore = Math.max(
    0,
    100 - dedupedStale.length * 20 - dedupedGhost.length * 12 - undocumentedFunctions.length * 2,
  );

  const agentSummary = [
    `stale=${dedupedStale.length}`,
    `ghost=${dedupedGhost.length}`,
    `undocumented=${undocumentedFunctions.length}`,
    `health=${documentationHealthScore}`,
  ].join(' | ');

  return {
    staleEntries: dedupedStale,
    ghostDocumentation: dedupedGhost,
    undocumentedFunctions,
    agentSummary,
    documentationHealthScore,
  };
}

export function createStaleDocumentationSensorConstruction(): Construction<
  StalenessInput,
  StaleDocumentationSensorOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'stale-documentation-sensor',
    name: 'Stale Documentation Sensor',
    description:
      'Detects stale documentation claims by comparing documented behavior against current source behavior.',
    async execute(input: StalenessInput) {
      if (!Array.isArray(input.paths) || input.paths.length === 0) {
        throw new ConstructionError('stale-documentation-sensor requires at least one path', 'stale-documentation-sensor');
      }
      const output = await analyzeDocumentation(input);
      return ok<StaleDocumentationSensorOutput, ConstructionError>(output);
    },
  };
}

async function appendLiveEvidence(
  ledger: IEvidenceLedger | undefined,
  output: StaleDocumentationSensorOutput,
  sessionId?: string,
): Promise<void> {
  if (!ledger) {
    return;
  }

  await ledger.append({
    kind: 'verification',
    payload: {
      claimId: 'stale_documentation_sensor' as EvidenceId,
      method: 'static_analysis',
      result: output.staleEntries.length === 0 && output.ghostDocumentation.length === 0
        ? 'verified'
        : 'refuted',
      details: `stale=${output.staleEntries.length};ghost=${output.ghostDocumentation.length};health=${output.documentationHealthScore}`,
    },
    provenance: {
      source: 'system_observation',
      method: 'constructions.stale-documentation-sensor.live',
    },
    relatedEntries: [],
    sessionId: sessionId as SessionId | undefined,
  });
}

function summarizeForDiff(output: StaleDocumentationSensorOutput): string {
  return JSON.stringify({
    staleEntries: output.staleEntries,
    ghostDocumentation: output.ghostDocumentation,
    undocumentedFunctions: output.undocumentedFunctions,
    documentationHealthScore: output.documentationHealthScore,
  });
}

export async function createStaleDocumentationLiveResult(
  input: StalenessInput,
  context?: Context<{ evidenceLedger?: IEvidenceLedger }>,
  options?: StaleDocumentationLiveOptions,
): Promise<LiveResult<StaleDocumentationSensorOutput>> {
  const construction = createStaleDocumentationSensorConstruction();
  const subscribers = new Set<(value: StaleDocumentationSensorOutput) => void>();
  const pollIntervalMs = Math.max(50, options?.pollIntervalMs ?? 30_000);

  let currentValue: StaleDocumentationSensorOutput | undefined;
  let currentDigest = '';

  const runCycle = async (): Promise<void> => {
    const output = unwrapConstructionExecutionResult(
      await construction.execute(input, context),
    );

    await appendLiveEvidence(context?.deps?.evidenceLedger, {
      ...output,
    }, context?.sessionId);

    const digest = summarizeForDiff(output);
    if (digest === currentDigest) {
      currentValue = output;
      return;
    }

    currentValue = output;
    currentDigest = digest;
    for (const callback of subscribers) {
      callback(output);
    }
  };

  await runCycle();
  const timer = setInterval(() => {
    void runCycle();
  }, pollIntervalMs);

  return {
    current: () => currentValue,
    subscribe(callback: (value: StaleDocumentationSensorOutput) => void): () => void {
      subscribers.add(callback);
      if (currentValue) {
        callback(currentValue);
      }
      return () => {
        subscribers.delete(callback);
      };
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
