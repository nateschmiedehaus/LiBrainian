import path from 'node:path';
import type { ASTFact } from './ast_fact_extractor.js';
import {
  createGroundTruthGenerator,
  type StructuralGroundTruthAnswer,
  type StructuralGroundTruthCorpus,
  type StructuralGroundTruthQuery,
} from './ground_truth_generator.js';

export type SelfUnderstandingQuestionType = 'callers' | 'implementation' | 'general';

export interface SelfUnderstandingQuestion {
  id: string;
  intent: string;
  type: SelfUnderstandingQuestionType;
  expectedAnswer: StructuralGroundTruthAnswer;
  evidence: ASTFact[];
}

export interface SelfUnderstandingAnswer {
  summary: string;
  keyFacts?: string[];
  snippets?: Array<{ file: string; startLine: number; endLine: number; code: string }>;
  relatedFiles?: string[];
  patterns?: string[];
  gotchas?: string[];
  methodHints?: string[];
  drillDownHints?: string[];
}

export interface SelfUnderstandingEvaluationResult {
  questionId: string;
  intent: string;
  type: SelfUnderstandingQuestionType;
  passed: boolean;
  score: number;
  matchedTerms: string[];
  missingTerms: string[];
  expectedTermCount: number;
}

export interface SelfUnderstandingThresholds {
  minQuestionCount: number;
  callersAccuracy: number;
  implementationAccuracy: number;
  perQuestionCallersScore: number;
  perQuestionImplementationScore: number;
  perQuestionGeneralScore: number;
}

export interface SelfUnderstandingReport {
  schema: 'SelfUnderstandingReport.v1';
  generatedAt: string;
  workspace: string;
  repoName: string;
  generatedQuestionCount: number;
  evaluatedQuestionCount: number;
  thresholds: SelfUnderstandingThresholds;
  metrics: {
    overallAccuracy: number;
    callersAccuracy: number;
    implementationAccuracy: number;
  };
  summary: {
    passed: boolean;
    reasons: string[];
  };
  results: SelfUnderstandingEvaluationResult[];
}

export interface EvaluateSelfUnderstandingOptions {
  workspace: string;
  repoName?: string;
  minQuestionCount?: number;
  maxQuestionCount?: number;
  answerTimeoutMs?: number;
  thresholds?: Partial<Omit<SelfUnderstandingThresholds, 'minQuestionCount'>>;
  answerQuestion: (intent: string) => Promise<SelfUnderstandingAnswer>;
  generateCorpus?: (workspace: string, repoName: string) => Promise<StructuralGroundTruthCorpus>;
  now?: () => Date;
}

const DEFAULT_THRESHOLDS: Omit<SelfUnderstandingThresholds, 'minQuestionCount'> = {
  callersAccuracy: 0.8,
  implementationAccuracy: 0.7,
  perQuestionCallersScore: 0.8,
  perQuestionImplementationScore: 0.7,
  perQuestionGeneralScore: 0.6,
};
const DEFAULT_ANSWER_TIMEOUT_MS = 45_000;
const MAX_EVALUATION_TEXT_CHARS = 200_000;
const MAX_EVALUATION_SNIPPETS = 25;
const ANSWER_TIMEOUT_REASON_PREFIX = 'answer_timeout_count:';
const ANSWER_FAILURE_REASON_PREFIX = 'answer_failure_count:';
const ANSWER_TIMEOUT_ERROR_PREFIX = 'answer_timeout_ms:';

function isCallersQuery(query: StructuralGroundTruthQuery): boolean {
  return query.id.startsWith('called-by-')
    || query.query.toLowerCase().includes('callers of');
}

function extractFunctionEvidence(corpus: StructuralGroundTruthCorpus): ASTFact[] {
  const byKey = new Map<string, ASTFact>();
  for (const query of corpus.queries) {
    for (const fact of query.expectedAnswer.evidence) {
      if (fact.type !== 'function_def') continue;
      const key = `${fact.file}:${fact.line}:${fact.identifier}`;
      if (!byKey.has(key)) {
        byKey.set(key, fact);
      }
    }
  }
  return Array.from(byKey.values());
}

function createImplementationQuestions(functionFacts: ASTFact[]): SelfUnderstandingQuestion[] {
  return functionFacts.map((fact, index) => {
    const fileName = path.basename(fact.file);
    const expectedTerms = [fact.identifier, fileName];
    return {
      id: `implementation-${index + 1}-${fact.identifier}`,
      intent: `How is ${fact.identifier} implemented?`,
      type: 'implementation',
      expectedAnswer: {
        type: 'contains',
        value: expectedTerms,
        evidence: [fact],
      },
      evidence: [fact],
    };
  });
}

function convertGroundTruthQuery(query: StructuralGroundTruthQuery): SelfUnderstandingQuestion {
  return {
    id: query.id,
    intent: query.query,
    type: isCallersQuery(query) ? 'callers' : 'general',
    expectedAnswer: query.expectedAnswer,
    evidence: query.expectedAnswer.evidence,
  };
}

export function buildSelfUnderstandingQuestionSet(
  corpus: StructuralGroundTruthCorpus,
  minQuestionCount = 50,
  maxQuestionCount = 60
): { questions: SelfUnderstandingQuestion[]; generatedQuestionCount: number } {
  const converted = corpus.queries.map(convertGroundTruthQuery);
  const callers = converted.filter((item) => item.type === 'callers');
  const nonCallers = converted.filter((item) => item.type !== 'callers');
  const implementationQuestions = createImplementationQuestions(extractFunctionEvidence(corpus));

  const deduped = new Map<string, SelfUnderstandingQuestion>();
  for (const question of callers) {
    deduped.set(question.id, question);
  }
  for (const question of implementationQuestions) {
    deduped.set(question.id, question);
  }
  for (const question of nonCallers) {
    deduped.set(question.id, question);
  }

  const allQuestions = Array.from(deduped.values());
  const targetCount = Math.max(minQuestionCount, 1);
  const limit = Math.max(targetCount, maxQuestionCount);
  const questions = allQuestions.slice(0, limit);

  return {
    questions,
    generatedQuestionCount: allQuestions.length,
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_./-]+/g, ' ').trim();
}

function appendBoundedText(parts: string[], budget: { used: number }, value: unknown): void {
  if (value === undefined || value === null) return;
  const text = String(value);
  if (text.length === 0) return;
  const remaining = MAX_EVALUATION_TEXT_CHARS - budget.used;
  if (remaining <= 0) return;
  const chunk = text.slice(0, remaining);
  parts.push(chunk);
  budget.used += chunk.length;
}

function collectAnswerText(answer: SelfUnderstandingAnswer): string {
  const parts: string[] = [];
  const budget = { used: 0 };
  appendBoundedText(parts, budget, answer.summary);
  if (answer.keyFacts) {
    for (const item of answer.keyFacts) appendBoundedText(parts, budget, item);
  }
  if (answer.relatedFiles) {
    for (const item of answer.relatedFiles) appendBoundedText(parts, budget, item);
  }
  if (answer.patterns) {
    for (const item of answer.patterns) appendBoundedText(parts, budget, item);
  }
  if (answer.gotchas) {
    for (const item of answer.gotchas) appendBoundedText(parts, budget, item);
  }
  if (answer.methodHints) {
    for (const item of answer.methodHints) appendBoundedText(parts, budget, item);
  }
  if (answer.drillDownHints) {
    for (const item of answer.drillDownHints) appendBoundedText(parts, budget, item);
  }
  if (answer.snippets) {
    for (const snippet of answer.snippets.slice(0, MAX_EVALUATION_SNIPPETS)) {
      appendBoundedText(parts, budget, snippet.file);
      appendBoundedText(parts, budget, snippet.code);
    }
  }
  return normalizeText(parts.join(' '));
}

function expectedTermsFromAnswer(expected: StructuralGroundTruthAnswer, evidence: ASTFact[]): string[] {
  if (typeof expected.value === 'string') {
    return [expected.value];
  }
  if (typeof expected.value === 'number') {
    return [String(expected.value)];
  }
  if (Array.isArray(expected.value)) {
    return expected.value.map((item) => String(item));
  }
  if (typeof expected.value === 'boolean' && expected.value) {
    const candidates = evidence
      .map((fact) => fact.identifier)
      .filter((identifier) => identifier.length > 0);
    return candidates.slice(0, 3);
  }
  return [];
}

function scoreQuestion(question: SelfUnderstandingQuestion, answer: SelfUnderstandingAnswer): SelfUnderstandingEvaluationResult {
  const haystack = collectAnswerText(answer);
  const expectedTerms = expectedTermsFromAnswer(question.expectedAnswer, question.evidence)
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);

  const uniqueTerms = Array.from(new Set(expectedTerms));
  const matchedTerms = uniqueTerms.filter((term) => haystack.includes(term));
  const missingTerms = uniqueTerms.filter((term) => !haystack.includes(term));
  const score = uniqueTerms.length === 0 ? 0 : matchedTerms.length / uniqueTerms.length;

  return {
    questionId: question.id,
    intent: question.intent,
    type: question.type,
    passed: false,
    score,
    matchedTerms,
    missingTerms,
    expectedTermCount: uniqueTerms.length,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function perQuestionThreshold(type: SelfUnderstandingQuestionType, thresholds: SelfUnderstandingThresholds): number {
  if (type === 'callers') return thresholds.perQuestionCallersScore;
  if (type === 'implementation') return thresholds.perQuestionImplementationScore;
  return thresholds.perQuestionGeneralScore;
}

function buildThresholds(
  minQuestionCount: number,
  overrides?: Partial<Omit<SelfUnderstandingThresholds, 'minQuestionCount'>>
): SelfUnderstandingThresholds {
  return {
    minQuestionCount,
    callersAccuracy: overrides?.callersAccuracy ?? DEFAULT_THRESHOLDS.callersAccuracy,
    implementationAccuracy: overrides?.implementationAccuracy ?? DEFAULT_THRESHOLDS.implementationAccuracy,
    perQuestionCallersScore: overrides?.perQuestionCallersScore ?? DEFAULT_THRESHOLDS.perQuestionCallersScore,
    perQuestionImplementationScore:
      overrides?.perQuestionImplementationScore ?? DEFAULT_THRESHOLDS.perQuestionImplementationScore,
    perQuestionGeneralScore: overrides?.perQuestionGeneralScore ?? DEFAULT_THRESHOLDS.perQuestionGeneralScore,
  };
}

function isAnswerTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(ANSWER_TIMEOUT_ERROR_PREFIX);
}

async function resolveAnswerWithTimeout(
  answerQuestion: (intent: string) => Promise<SelfUnderstandingAnswer>,
  intent: string,
  timeoutMs: number
): Promise<SelfUnderstandingAnswer> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${ANSWER_TIMEOUT_ERROR_PREFIX}${timeoutMs}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([answerQuestion(intent), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function evaluateSelfUnderstanding(
  options: EvaluateSelfUnderstandingOptions
): Promise<SelfUnderstandingReport> {
  const repoName = options.repoName ?? 'self';
  const minQuestionCount = Math.max(1, options.minQuestionCount ?? 50);
  const maxQuestionCount = Math.max(minQuestionCount, options.maxQuestionCount ?? 60);
  const answerTimeoutMs = Math.max(1, Math.floor(options.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS));
  const thresholds = buildThresholds(minQuestionCount, options.thresholds);
  const now = options.now ?? (() => new Date());
  const generateCorpus =
    options.generateCorpus
    ?? (async (workspace: string, currentRepoName: string) =>
      createGroundTruthGenerator().generateForRepo(workspace, currentRepoName));

  const corpus = await generateCorpus(options.workspace, repoName);
  const { questions, generatedQuestionCount } = buildSelfUnderstandingQuestionSet(
    corpus,
    minQuestionCount,
    maxQuestionCount
  );

  const results: SelfUnderstandingEvaluationResult[] = [];
  let answerTimeoutCount = 0;
  let answerFailureCount = 0;
  for (const question of questions) {
    try {
      const answer = await resolveAnswerWithTimeout(options.answerQuestion, question.intent, answerTimeoutMs);
      const scored = scoreQuestion(question, answer);
      const threshold = perQuestionThreshold(question.type, thresholds);
      results.push({
        ...scored,
        passed: scored.score >= threshold,
      });
    } catch (error) {
      if (isAnswerTimeoutError(error)) {
        answerTimeoutCount += 1;
      } else {
        answerFailureCount += 1;
      }
      const scored = scoreQuestion(question, { summary: '' });
      results.push({
        ...scored,
        passed: false,
      });
    }
  }

  const callers = results.filter((item) => item.type === 'callers');
  const implementations = results.filter((item) => item.type === 'implementation');
  const overallAccuracy = average(results.map((item) => (item.passed ? 1 : 0)));
  const callersAccuracy = average(callers.map((item) => (item.passed ? 1 : 0)));
  const implementationAccuracy = average(implementations.map((item) => (item.passed ? 1 : 0)));

  const reasons: string[] = [];
  if (generatedQuestionCount < thresholds.minQuestionCount) {
    reasons.push(`question_count_below_threshold:${generatedQuestionCount}<${thresholds.minQuestionCount}`);
  }
  if (callersAccuracy < thresholds.callersAccuracy) {
    reasons.push(`callers_accuracy_below_threshold:${callersAccuracy.toFixed(3)}<${thresholds.callersAccuracy}`);
  }
  if (implementationAccuracy < thresholds.implementationAccuracy) {
    reasons.push(
      `implementation_accuracy_below_threshold:${implementationAccuracy.toFixed(3)}<${thresholds.implementationAccuracy}`
    );
  }
  if (callers.length === 0) {
    reasons.push('callers_queries_missing');
  }
  if (implementations.length === 0) {
    reasons.push('implementation_queries_missing');
  }
  if (answerTimeoutCount > 0) {
    reasons.push(`${ANSWER_TIMEOUT_REASON_PREFIX}${answerTimeoutCount}`);
  }
  if (answerFailureCount > 0) {
    reasons.push(`${ANSWER_FAILURE_REASON_PREFIX}${answerFailureCount}`);
  }

  return {
    schema: 'SelfUnderstandingReport.v1',
    generatedAt: now().toISOString(),
    workspace: options.workspace,
    repoName,
    generatedQuestionCount,
    evaluatedQuestionCount: results.length,
    thresholds,
    metrics: {
      overallAccuracy,
      callersAccuracy,
      implementationAccuracy,
    },
    summary: {
      passed: reasons.length === 0,
      reasons,
    },
    results,
  };
}

export interface SelfUnderstandingHistoryEntry {
  generatedAt: string;
  workspace: string;
  repoName: string;
  commitSha?: string;
  passed: boolean;
  overallAccuracy: number;
  callersAccuracy: number;
  implementationAccuracy: number;
  generatedQuestionCount: number;
  evaluatedQuestionCount: number;
}

export function toSelfUnderstandingHistoryEntry(
  report: SelfUnderstandingReport,
  commitSha?: string
): SelfUnderstandingHistoryEntry {
  return {
    generatedAt: report.generatedAt,
    workspace: report.workspace,
    repoName: report.repoName,
    commitSha,
    passed: report.summary.passed,
    overallAccuracy: report.metrics.overallAccuracy,
    callersAccuracy: report.metrics.callersAccuracy,
    implementationAccuracy: report.metrics.implementationAccuracy,
    generatedQuestionCount: report.generatedQuestionCount,
    evaluatedQuestionCount: report.evaluatedQuestionCount,
  };
}

export function renderSelfUnderstandingDashboard(
  report: SelfUnderstandingReport,
  history: SelfUnderstandingHistoryEntry[]
): string {
  const historyRows = history
    .slice(-20)
    .reverse()
    .map((entry) => {
      const commit = entry.commitSha ?? 'n/a';
      return `| ${entry.generatedAt} | ${commit} | ${entry.overallAccuracy.toFixed(3)} | ${entry.callersAccuracy.toFixed(3)} | ${entry.implementationAccuracy.toFixed(3)} | ${entry.passed ? 'pass' : 'fail'} |`;
    })
    .join('\n');

  return [
    '# Self-understanding report',
    '',
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.workspace}`,
    `Repo: ${report.repoName}`,
    '',
    `Overall accuracy: ${report.metrics.overallAccuracy.toFixed(3)}`,
    `Callers accuracy: ${report.metrics.callersAccuracy.toFixed(3)} (threshold ${report.thresholds.callersAccuracy})`,
    `Implementation accuracy: ${report.metrics.implementationAccuracy.toFixed(3)} (threshold ${report.thresholds.implementationAccuracy})`,
    `Question count: ${report.generatedQuestionCount} generated / ${report.evaluatedQuestionCount} evaluated`,
    `Gate: ${report.summary.passed ? 'pass' : 'fail'}`,
    '',
    report.summary.reasons.length > 0
      ? `Reasons: ${report.summary.reasons.join(', ')}`
      : 'Reasons: none',
    '',
    '## History (latest 20)',
    '',
    '| generatedAt | commit | overall | callers | implementation | gate |',
    '| --- | --- | --- | --- | --- | --- |',
    historyRows || '| n/a | n/a | n/a | n/a | n/a | n/a |',
    '',
  ].join('\n');
}
