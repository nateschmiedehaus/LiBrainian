import type { ContextPack } from '../types.js';

export interface LibrarianEvalCase {
  query: string;
  groundTruthFacts: string[];
  retrievalContext: ContextPack[];
  expectedTools: string[];
}

export interface RetrievalClaimVerdict {
  claim: string;
  supportedByGroundTruth: boolean;
  matchedFacts: string[];
  confidence: number;
}

export interface FaithfulnessSplitResult {
  score: number;
  totalClaims: number;
  supportedClaims: number;
  unsupportedClaims: string[];
  verdicts: RetrievalClaimVerdict[];
  retrievalCoverage: number;
}

export interface AnswerRelevancySplitResult {
  score: number;
  generatedQueries: string[];
  similarities: number[];
}

export type SplitFailureMode = 'pass' | 'retrieval_failure' | 'synthesis_failure' | 'mixed_failure';

export interface SplitFailureDiagnosis {
  failureMode: SplitFailureMode;
  retrievalCoverage: number;
  faithfulness: number;
  answerRelevancy: number;
  rationale: string;
}

export interface EvaluationCostSummary {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface DeepEvalSplitResult {
  faithfulness: FaithfulnessSplitResult;
  answerRelevancy: AnswerRelevancySplitResult;
  diagnosis: SplitFailureDiagnosis;
  evaluationCost: EvaluationCostSummary;
}

export interface DeepEvalSplitConfig {
  inputCostPer1M?: number;
  outputCostPer1M?: number;
}

export interface DagMetricStepResult {
  stepId: string;
  passed: boolean;
  score: number;
  status: 'evaluated' | 'skipped_dependency';
  reason?: string;
}

export interface DagMetricStep {
  id: string;
  dependsOn?: string[];
  evaluate: () => Promise<{ passed: boolean; score: number; reason?: string }>;
}

export interface DagMetricReport {
  passed: boolean;
  steps: DagMetricStepResult[];
}

const DEFAULT_INPUT_COST_PER_1M = 3;
const DEFAULT_OUTPUT_COST_PER_1M = 15;

export class DeepEvalSplitMetrics {
  private readonly inputCostPer1M: number;
  private readonly outputCostPer1M: number;

  constructor(config: DeepEvalSplitConfig = {}) {
    this.inputCostPer1M = config.inputCostPer1M ?? DEFAULT_INPUT_COST_PER_1M;
    this.outputCostPer1M = config.outputCostPer1M ?? DEFAULT_OUTPUT_COST_PER_1M;
  }

  evaluateFaithfulnessSplit(evalCase: LibrarianEvalCase): FaithfulnessSplitResult {
    const retrievalClaims = extractRetrievalClaims(evalCase.retrievalContext);
    if (retrievalClaims.length === 0) {
      return {
        score: 0,
        totalClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: [],
        verdicts: [],
        retrievalCoverage: 0,
      };
    }

    const verdicts: RetrievalClaimVerdict[] = retrievalClaims.map((claim) => {
      const matchedFacts = evalCase.groundTruthFacts.filter((fact) => semanticSimilarity(claim, fact) >= 0.55);
      const supportedByGroundTruth = matchedFacts.length > 0;
      return {
        claim,
        supportedByGroundTruth,
        matchedFacts,
        confidence: supportedByGroundTruth ? Math.min(0.99, 0.55 + matchedFacts.length * 0.2) : 0.25,
      };
    });

    const supportedClaims = verdicts.filter((verdict) => verdict.supportedByGroundTruth).length;
    const unsupportedClaims = verdicts
      .filter((verdict) => !verdict.supportedByGroundTruth)
      .map((verdict) => verdict.claim);

    const coveredFacts = evalCase.groundTruthFacts.filter((fact) =>
      retrievalClaims.some((claim) => semanticSimilarity(claim, fact) >= 0.55)
    );

    return {
      score: supportedClaims / verdicts.length,
      totalClaims: verdicts.length,
      supportedClaims,
      unsupportedClaims,
      verdicts,
      retrievalCoverage: evalCase.groundTruthFacts.length > 0
        ? coveredFacts.length / evalCase.groundTruthFacts.length
        : 0,
    };
  }

  evaluateAnswerRelevancy(query: string, retrievalContext: ContextPack[]): AnswerRelevancySplitResult {
    const generatedQueries = buildHypotheticalQueries(query, retrievalContext);
    if (generatedQueries.length === 0) {
      return { score: 0, generatedQueries: [], similarities: [] };
    }
    const similarities = generatedQueries.map((candidate) => semanticSimilarity(query, candidate));
    const score = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
    return { score, generatedQueries, similarities };
  }

  evaluateCase(evalCase: LibrarianEvalCase): DeepEvalSplitResult {
    const faithfulness = this.evaluateFaithfulnessSplit(evalCase);
    const answerRelevancy = this.evaluateAnswerRelevancy(evalCase.query, evalCase.retrievalContext);
    const diagnosis = diagnoseSplitFailure({
      faithfulness: faithfulness.score,
      answerRelevancy: answerRelevancy.score,
      retrievalCoverage: faithfulness.retrievalCoverage,
    });

    const inputText = [
      evalCase.query,
      ...evalCase.groundTruthFacts,
      ...extractRetrievalClaims(evalCase.retrievalContext),
    ].join('\n');
    const outputText = [
      ...answerRelevancy.generatedQueries,
      ...faithfulness.unsupportedClaims,
      diagnosis.rationale,
    ].join('\n');
    const evaluationCost = estimateEvaluationCost(inputText, outputText, this.inputCostPer1M, this.outputCostPer1M);

    return {
      faithfulness,
      answerRelevancy,
      diagnosis,
      evaluationCost,
    };
  }
}

export function diagnoseSplitFailure(input: {
  faithfulness: number;
  answerRelevancy: number;
  retrievalCoverage: number;
}): SplitFailureDiagnosis {
  const { faithfulness, answerRelevancy, retrievalCoverage } = input;
  if (retrievalCoverage < 0.5 || faithfulness < 0.5) {
    return {
      failureMode: answerRelevancy < 0.5 ? 'mixed_failure' : 'retrieval_failure',
      retrievalCoverage,
      faithfulness,
      answerRelevancy,
      rationale: 'Retrieved context is not sufficiently grounded in ground truth facts.',
    };
  }

  if (answerRelevancy < 0.5) {
    return {
      failureMode: 'synthesis_failure',
      retrievalCoverage,
      faithfulness,
      answerRelevancy,
      rationale: 'Retrieved facts are grounded but relevance to the query intent is weak.',
    };
  }

  return {
    failureMode: 'pass',
    retrievalCoverage,
    faithfulness,
    answerRelevancy,
    rationale: 'Retrieval context is grounded and relevant.',
  };
}

export async function evaluateDagMetric(steps: DagMetricStep[]): Promise<DagMetricReport> {
  const results = new Map<string, DagMetricStepResult>();
  for (const step of steps) {
    const dependencies = step.dependsOn ?? [];
    const blocked = dependencies.some((dependencyId) => !results.get(dependencyId)?.passed);
    if (blocked) {
      results.set(step.id, {
        stepId: step.id,
        passed: false,
        score: 0,
        status: 'skipped_dependency',
        reason: 'dependency_failed',
      });
      continue;
    }
    const outcome = await step.evaluate();
    results.set(step.id, {
      stepId: step.id,
      passed: outcome.passed,
      score: outcome.score,
      status: 'evaluated',
      reason: outcome.reason,
    });
  }
  const ordered = steps.map((step) => results.get(step.id)).filter((value): value is DagMetricStepResult => Boolean(value));
  return {
    passed: ordered.every((result) => result.passed),
    steps: ordered,
  };
}

function estimateEvaluationCost(
  inputText: string,
  outputText: string,
  inputCostPer1M: number,
  outputCostPer1M: number,
): EvaluationCostSummary {
  const estimatedInputTokens = estimateTokens(inputText);
  const estimatedOutputTokens = estimateTokens(outputText);
  const estimatedCostUsd = (estimatedInputTokens / 1_000_000) * inputCostPer1M
    + (estimatedOutputTokens / 1_000_000) * outputCostPer1M;
  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
  };
}

function estimateTokens(value: string): number {
  if (!value) return 0;
  return Math.ceil(value.length / 4);
}

function extractRetrievalClaims(retrievalContext: ContextPack[]): string[] {
  const claims: string[] = [];
  for (const pack of retrievalContext) {
    if (pack.summary.trim()) claims.push(pack.summary.trim());
    for (const fact of pack.keyFacts) {
      const trimmed = fact.trim();
      if (trimmed) claims.push(trimmed);
    }
  }
  return Array.from(new Set(claims));
}

function buildHypotheticalQueries(query: string, retrievalContext: ContextPack[]): string[] {
  const normalizedQuery = query.trim();
  const tokens = topTokensFromContext(retrievalContext, 5);
  if (tokens.length === 0) {
    return normalizedQuery ? [normalizedQuery] : [];
  }
  const generated = tokens.map((token) => `How is ${token} implemented?`);
  if (normalizedQuery) generated.unshift(normalizedQuery);
  return generated.slice(0, 5);
}

function topTokensFromContext(retrievalContext: ContextPack[], maxTokens: number): string[] {
  const counts = new Map<string, number>();
  const text = extractRetrievalClaims(retrievalContext).join(' ').toLowerCase();
  for (const token of text.split(/[^a-z0-9_]+/)) {
    if (token.length < 4 || STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxTokens)
    .map(([token]) => token);
}

function semanticSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const denominator = Math.sqrt(leftTokens.size * rightTokens.size);
  return denominator > 0 ? overlap / denominator : 0;
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'into', 'when', 'where', 'which',
  'will', 'have', 'has', 'are', 'was', 'were', 'can', 'could', 'should', 'would', 'about',
  'what', 'how', 'does', 'did', 'use', 'used', 'using', 'into',
]);
