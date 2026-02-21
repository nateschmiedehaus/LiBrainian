import path from 'node:path';
import { access } from 'node:fs/promises';
import { createLibrarian } from '../api/librarian.js';
import type { ContextPack } from '../types.js';
import { createGroundTruthGenerator, type StructuralGroundTruthQuery } from './ground_truth_generator.js';
import { createASTFactExtractor, type ASTFact, type ASTFactType } from './ast_fact_extractor.js';

export type SelfUnderstandingQueryType = 'callers' | 'implementation' | 'other';

export interface SelfUnderstandingThresholds {
  callersMinAccuracy: number;
  implementationMinAccuracy: number;
}

export interface SelfUnderstandingCategoryScore {
  total: number;
  passed: number;
  accuracy: number;
}

export interface SelfUnderstandingQueryResult {
  id: string;
  query: string;
  queryType: SelfUnderstandingQueryType;
  passed: boolean;
  expectedFiles: string[];
  matchedFiles: string[];
  expectedTokens: string[];
  matchedTokens: string[];
  tokenRecall: number;
}

export interface SelfUnderstandingEvaluationReport {
  kind: 'SelfUnderstandingReport.v1';
  generatedAt: string;
  workspace: string;
  repoName: string;
  totalQuestions: number;
  thresholds: SelfUnderstandingThresholds;
  thresholdsPassed: boolean;
  overall: SelfUnderstandingCategoryScore;
  callers: SelfUnderstandingCategoryScore;
  implementation: SelfUnderstandingCategoryScore;
  dashboard: {
    selfUnderstandingScore: number;
    callersAccuracy: number;
    implementationAccuracy: number;
    status: 'pass' | 'fail';
  };
  queryResults: SelfUnderstandingQueryResult[];
}

export interface SelfUnderstandingQueryResponse {
  packs: ContextPack[];
}

export type SelfUnderstandingQueryExecutor = (
  queryText: string
) => Promise<SelfUnderstandingQueryResponse>;

interface SelfUnderstandingGroundTruthGenerator {
  generateForRepo(repoPath: string, repoName: string): Promise<{ queries: StructuralGroundTruthQuery[] }>;
}

export interface SelfUnderstandingEvaluationOptions {
  workspace: string;
  repoName?: string;
  minQuestions?: number;
  maxQuestions?: number;
  minTokenRecall?: number;
  queryDepth?: 'L0' | 'L1' | 'L2' | 'L3';
  queryTokenBudget?: number;
  maxFactsPerType?: number;
  timeoutMs?: number;
  skipEmbeddings?: boolean;
  autoBootstrap?: boolean;
  thresholds?: Partial<SelfUnderstandingThresholds>;
  executeQuery?: SelfUnderstandingQueryExecutor;
  groundTruthGenerator?: SelfUnderstandingGroundTruthGenerator;
}

const DEFAULT_THRESHOLDS: SelfUnderstandingThresholds = {
  callersMinAccuracy: 0.8,
  implementationMinAccuracy: 0.7,
};

const DEFAULT_MIN_QUESTIONS = 50;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_TOKEN_RECALL = 0.5;
const DEFAULT_QUERY_DEPTH: 'L0' | 'L1' | 'L2' | 'L3' = 'L1';
const DEFAULT_QUERY_TOKEN_BUDGET = 800;
const DEFAULT_MAX_FACTS_PER_TYPE = 250;
const MAX_TEXT_CHARS_PER_SECTION = 2_000;
const MAX_TEXT_CHARS_TOTAL = 12_000;

export function inferSelfUnderstandingQueryType(queryText: string): SelfUnderstandingQueryType {
  const text = queryText.toLowerCase();
  if (text.includes('callers of') || text.includes('who called by')) {
    return 'callers';
  }
  if (text.startsWith('how is ') && text.includes(' implemented')) {
    return 'implementation';
  }
  return 'other';
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function toRelativePath(filePath: string, workspace: string): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedWorkspace = normalizePath(path.resolve(workspace));
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

function pathMatches(expectedFile: string, actualFile: string): boolean {
  const expected = normalizePath(expectedFile);
  const actual = normalizePath(actualFile);
  if (expected === actual) return true;
  if (expected.endsWith('/')) return actual.startsWith(expected);
  return actual.endsWith(expected);
}

function normalizeTokenSet(tokens: string[]): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

function extractExpectedTokens(query: StructuralGroundTruthQuery): string[] {
  const tokens: string[] = [];
  const value = query.expectedAnswer.value;
  if (typeof value === 'string') {
    tokens.push(value);
  } else if (typeof value === 'number') {
    tokens.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        tokens.push(item);
      }
    }
  } else if (typeof value === 'boolean' && value) {
    for (const evidence of query.expectedAnswer.evidence) {
      tokens.push(evidence.identifier);
    }
  }

  for (const evidence of query.expectedAnswer.evidence) {
    tokens.push(evidence.identifier);
  }

  return normalizeTokenSet(tokens);
}

function extractExpectedFiles(query: StructuralGroundTruthQuery, workspace?: string): string[] {
  return normalizeTokenSet(
    query.expectedAnswer.evidence.map((evidence) =>
      workspace ? toRelativePath(evidence.file, workspace) : normalizePath(evidence.file))
  );
}

function collectRetrievedFiles(packs: ContextPack[], workspace?: string): string[] {
  const files: string[] = [];
  for (const pack of packs) {
    for (const relatedFile of pack.relatedFiles ?? []) {
      files.push(workspace ? toRelativePath(relatedFile, workspace) : normalizePath(relatedFile));
    }
    for (const snippet of pack.codeSnippets ?? []) {
      if (snippet.filePath) {
        files.push(workspace ? toRelativePath(snippet.filePath, workspace) : normalizePath(snippet.filePath));
      }
    }
  }
  return normalizeTokenSet(files);
}

function collectRetrievedText(packs: ContextPack[]): string {
  const parts: string[] = [];
  let totalChars = 0;
  const push = (value: string): void => {
    if (totalChars >= MAX_TEXT_CHARS_TOTAL) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    const clipped = trimmed.slice(0, MAX_TEXT_CHARS_PER_SECTION);
    parts.push(clipped);
    totalChars += clipped.length;
  };

  for (const pack of packs) {
    push(pack.summary);
    for (const fact of pack.keyFacts ?? []) {
      push(fact);
    }
    for (const relatedFile of pack.relatedFiles ?? []) {
      push(relatedFile);
    }
    for (const snippet of pack.codeSnippets ?? []) {
      push(snippet.filePath ?? '');
      push(snippet.content ?? '');
    }
  }
  return parts.join('\n').toLowerCase();
}

export function evaluateSelfUnderstandingQuery(
  query: StructuralGroundTruthQuery,
  packs: ContextPack[],
  options: { workspace?: string; minTokenRecall?: number } = {}
): SelfUnderstandingQueryResult {
  const expectedFiles = extractExpectedFiles(query, options.workspace);
  const retrievedFiles = collectRetrievedFiles(packs, options.workspace);
  const retrievedText = collectRetrievedText(packs);
  const expectedTokens = extractExpectedTokens(query);
  const minTokenRecall = options.minTokenRecall ?? DEFAULT_MIN_TOKEN_RECALL;

  const matchedFiles = expectedFiles.filter((expectedFile) =>
    retrievedFiles.some((actualFile) => pathMatches(expectedFile, actualFile)));

  const matchedTokens = expectedTokens.filter((token) => retrievedText.includes(token.toLowerCase()));
  const tokenRecall = expectedTokens.length > 0 ? matchedTokens.length / expectedTokens.length : 1;

  const passed = matchedFiles.length > 0 && tokenRecall >= minTokenRecall;
  return {
    id: query.id,
    query: query.query,
    queryType: inferSelfUnderstandingQueryType(query.query),
    passed,
    expectedFiles,
    matchedFiles,
    expectedTokens,
    matchedTokens,
    tokenRecall,
  };
}

function scoreCategory(results: SelfUnderstandingQueryResult[]): SelfUnderstandingCategoryScore {
  if (results.length === 0) {
    return { total: 0, passed: 0, accuracy: 0 };
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    accuracy: passed / results.length,
  };
}

function resolveThresholds(
  thresholds: Partial<SelfUnderstandingThresholds> | undefined
): SelfUnderstandingThresholds {
  return {
    callersMinAccuracy: thresholds?.callersMinAccuracy ?? DEFAULT_THRESHOLDS.callersMinAccuracy,
    implementationMinAccuracy:
      thresholds?.implementationMinAccuracy ?? DEFAULT_THRESHOLDS.implementationMinAccuracy,
  };
}

function selectQuestions(
  queries: StructuralGroundTruthQuery[],
  minQuestions: number,
  maxQuestions?: number
): StructuralGroundTruthQuery[] {
  const sorted = [...queries].sort((left, right) => left.id.localeCompare(right.id));
  const selected =
    typeof maxQuestions === 'number' && maxQuestions > 0
      ? sorted.slice(0, maxQuestions)
      : sorted;

  if (selected.length < minQuestions) {
    throw new Error(
      `self_understanding_insufficient_questions: generated ${selected.length} questions but requires at least ${minQuestions}`
    );
  }

  return selected;
}

async function resolveAstRoot(workspace: string): Promise<string> {
  const srcRoot = path.join(workspace, 'src');
  try {
    await access(srcRoot);
    return srcRoot;
  } catch {
    return workspace;
  }
}

function sortFacts(facts: ASTFact[]): ASTFact[] {
  return [...facts].sort((left, right) => {
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    if (left.line !== right.line) return left.line - right.line;
    return left.identifier.localeCompare(right.identifier);
  });
}

function sampleFactsByType(facts: ASTFact[], maxFactsPerType: number): ASTFact[] {
  const factTypes: ASTFactType[] = ['function_def', 'import', 'class', 'call', 'export', 'type'];
  const sampled: ASTFact[] = [];
  for (const type of factTypes) {
    const typedFacts = sortFacts(facts.filter((fact) => fact.type === type)).slice(0, maxFactsPerType);
    sampled.push(...typedFacts);
  }
  return sampled;
}

async function generateBoundedQueries(
  workspace: string,
  maxFactsPerType: number
): Promise<StructuralGroundTruthQuery[]> {
  const astRoot = await resolveAstRoot(workspace);
  const extractor = createASTFactExtractor({ includeExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] });
  const facts = await extractor.extractFromDirectory(astRoot);
  const sampledFacts = sampleFactsByType(facts, maxFactsPerType);
  const generator = createGroundTruthGenerator(extractor);

  return [
    ...generator.generateFunctionQueries(sampledFacts),
    ...generator.generateImportQueries(sampledFacts),
    ...generator.generateClassQueries(sampledFacts),
    ...generator.generateImplementationQueries(sampledFacts),
    ...generator.generateCallGraphQueries(sampledFacts),
  ];
}

async function withTemporaryLibrarianExecutor(
  options: SelfUnderstandingEvaluationOptions,
  evaluate: (executor: SelfUnderstandingQueryExecutor) => Promise<SelfUnderstandingEvaluationReport>
): Promise<SelfUnderstandingEvaluationReport> {
  const librarian = await createLibrarian({
    workspace: options.workspace,
    autoBootstrap: options.autoBootstrap ?? false,
    autoWatch: false,
    skipEmbeddings: options.skipEmbeddings ?? false,
  });

  try {
    const status = await librarian.getStatus();
    if (!status.bootstrapped) {
      throw new Error(
        'self_understanding_workspace_not_bootstrapped: run `librarian update` first or re-run with autoBootstrap enabled'
      );
    }

    const executeQuery: SelfUnderstandingQueryExecutor = async (queryText) => {
      const queryTokenBudget = options.queryTokenBudget ?? DEFAULT_QUERY_TOKEN_BUDGET;
      const response = await librarian.queryOptional({
        intent: queryText,
        depth: options.queryDepth ?? DEFAULT_QUERY_DEPTH,
        llmRequirement: 'disabled',
        deterministic: true,
        disableCache: true,
        maxEscalationDepth: 0,
        tokenBudget:
          queryTokenBudget > 0
            ? {
                maxTokens: queryTokenBudget,
                reserveTokens: 0,
                priority: 'relevance',
              }
            : undefined,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      return { packs: response.packs };
    };
    return await evaluate(executeQuery);
  } finally {
    await librarian.shutdown();
  }
}

export async function runSelfUnderstandingEvaluation(
  options: SelfUnderstandingEvaluationOptions
): Promise<SelfUnderstandingEvaluationReport> {
  const minQuestions = options.minQuestions ?? DEFAULT_MIN_QUESTIONS;
  const repoName = options.repoName ?? path.basename(path.resolve(options.workspace));
  const thresholds = resolveThresholds(options.thresholds);
  const selectedQueries = selectQuestions(
    options.groundTruthGenerator
      ? (await options.groundTruthGenerator.generateForRepo(options.workspace, repoName)).queries
      : await generateBoundedQueries(
          options.workspace,
          options.maxFactsPerType ?? DEFAULT_MAX_FACTS_PER_TYPE
        ),
    minQuestions,
    options.maxQuestions
  );

  const evaluateWithExecutor = async (
    executeQuery: SelfUnderstandingQueryExecutor
  ): Promise<SelfUnderstandingEvaluationReport> => {
    const queryResults: SelfUnderstandingQueryResult[] = [];
    for (const query of selectedQueries) {
      const response = await executeQuery(query.query);
      queryResults.push(
        evaluateSelfUnderstandingQuery(query, response.packs, {
          workspace: options.workspace,
          minTokenRecall: options.minTokenRecall ?? DEFAULT_MIN_TOKEN_RECALL,
        })
      );
    }

    const callers = scoreCategory(queryResults.filter((result) => result.queryType === 'callers'));
    const implementation = scoreCategory(
      queryResults.filter((result) => result.queryType === 'implementation')
    );
    const overall = scoreCategory(queryResults);
    const thresholdsPassed =
      callers.accuracy >= thresholds.callersMinAccuracy
      && implementation.accuracy >= thresholds.implementationMinAccuracy;

    return {
      kind: 'SelfUnderstandingReport.v1',
      generatedAt: new Date().toISOString(),
      workspace: path.resolve(options.workspace),
      repoName,
      totalQuestions: queryResults.length,
      thresholds,
      thresholdsPassed,
      overall,
      callers,
      implementation,
      dashboard: {
        selfUnderstandingScore: Math.round(overall.accuracy * 100),
        callersAccuracy: Math.round(callers.accuracy * 100),
        implementationAccuracy: Math.round(implementation.accuracy * 100),
        status: thresholdsPassed ? 'pass' : 'fail',
      },
      queryResults,
    };
  };

  if (options.executeQuery) {
    return evaluateWithExecutor(options.executeQuery);
  }
  return withTemporaryLibrarianExecutor(options, evaluateWithExecutor);
}
