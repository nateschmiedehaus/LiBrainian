/**
 * @fileoverview Eval runner for Librarian ground-truth corpus.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve, isAbsolute, relative, sep } from 'node:path';
import { computeCitationAccuracy, type CitationInput } from './citation_accuracy.js';
import { computeRetrievalMetrics } from './metrics.js';
import { computeSynthesisMetrics } from './synthesis_metrics.js';
import { withTimeout } from '../utils/async.js';

// ============================================================================
// CORPUS TYPES
// ============================================================================

export type GroundTruthCategory =
  | 'structural'
  | 'behavioral'
  | 'architectural'
  | 'impact'
  | 'security';

export type GroundTruthDifficulty = 'trivial' | 'moderate' | 'hard' | 'research';

export interface EvidenceRef {
  refId: string;
  kind: string;
  label: string;
  path?: string;
  uri?: string;
  ref?: string;
}

export interface CorrectAnswer {
  summary: string;
  mustIncludeFiles: string[];
  shouldIncludeFiles: string[];
  mustIncludeFacts: string[];
  mustNotClaim: string[];
  acceptableVariations: string[];
  evidenceRefs: EvidenceRef[];
  evidenceLinks?: Array<{ kind: string; target: string; refIds: string[] }>;
}

export interface GroundTruthQuery {
  queryId: string;
  repoId: string;
  corpusId?: string;
  intent: string;
  category: GroundTruthCategory;
  difficulty: GroundTruthDifficulty;
  correctAnswer: CorrectAnswer;
  lastVerified: string;
  verifiedBy: string;
  verificationNotes?: string;
  tags?: string[];
}

export interface RepoManifest {
  repoId: string;
  name: string;
  languages: string[];
  fileCount: number;
  annotationLevel: 'full' | 'partial' | 'sparse';
  corpusId?: string;
  characteristics: {
    documentationDensity: 'high' | 'medium' | 'low';
    testCoverage: 'high' | 'medium' | 'low';
    architecturalClarity: 'clear' | 'moderate' | 'complex';
    codeQuality: 'clean' | 'average' | 'legacy';
  };
}

export interface EvalCorpus {
  version: string;
  repos: RepoManifest[];
  queries: GroundTruthQuery[];
  sources: EvalCorpusSource[];
}

export interface EvalCorpusSource {
  id: string;
  path: string;
}

// ============================================================================
// PIPELINE TYPES
// ============================================================================

export interface EvalQueryInput {
  query: GroundTruthQuery;
  repo: RepoManifest;
  repoRoot: string;
}

export interface RetrievalResult {
  docs: string[];
  latencyMs?: number;
  scores?: number[];
}

export interface SynthesisResult {
  answer: string;
  claims?: string[];
  citations?: CitationInput[];
  latencyMs?: number;
}

export interface EvalPipeline {
  retrieve: (input: EvalQueryInput) => Promise<RetrievalResult>;
  synthesize?: (input: EvalQueryInput & { retrieval: RetrievalResult }) => Promise<SynthesisResult>;
}

// ============================================================================
// RUNNER TYPES
// ============================================================================

export interface EvalOptions {
  corpusPath: string;
  corpusPaths?: string[];
  queryFilter?: {
    categories?: GroundTruthCategory[];
    difficulties?: GroundTruthDifficulty[];
    repoIds?: string[];
    queryIds?: string[];
  };
  parallel?: number;
  timeoutMs?: number;
  includeLatency?: boolean;
  /**
   * Optional cap on number of repos included in the run (after queryFilter).
   * Useful for budgeted evaluation (e.g., Ralph loop).
   */
  maxRepos?: number;
  /**
   * Optional cap on number of queries evaluated (after queryFilter/maxRepos).
   * Useful for budgeted evaluation (e.g., Ralph loop).
   */
  maxQueries?: number;
}

export interface QueryEvalResult {
  queryId: string;
  repoId: string;
  category: GroundTruthCategory;
  difficulty: GroundTruthDifficulty;
  intent: string;
  retrieval: RetrievalEvalResult;
  synthesis?: SynthesisEvalResult;
  score: number;
  errors?: string[];
}

export interface RetrievalEvalResult {
  retrievedDocs: string[];
  recallAtK: Record<number, number>;
  precisionAtK: Record<number, number>;
  ndcgAtK: Record<number, number>;
  mrr: number;
  map: number;
  requiredRecall: number;
  latencyMs?: number;
}

export interface SynthesisEvalResult {
  answer: string;
  claims: string[];
  factPrecision: number;
  factRecall: number;
  summaryAccuracy: number;
  consistencyScore: number;
  hallucinationCount: number;
  hallucinationRate: number;
  groundingRate: number;
  fabricationRate: number | null;
  citationAccuracy: number | null;
  missingFacts: string[];
  falseClaims: string[];
  structuralAccuracy?: number;
  behavioralAccuracy?: number;
  latencyMs?: number;
}

export interface EvalReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  corpusVersion: string;
  options: EvalOptions;
  queryCount: number;
  metrics: EvalMetrics;
  queryResults: QueryEvalResult[];
}

export interface EvalMetrics {
  retrieval: {
    recallAtK: Record<number, number>;
    precisionAtK: Record<number, number>;
    mrr: number;
    map: number;
    ndcg: number;
  };
  synthesis: {
    factPrecision: number;
    factRecall: number;
    summaryAccuracy: number;
    consistencyScore: number;
    structuralAccuracy: number;
    behavioralAccuracy: number;
  };
  hallucination: {
    hallucinationRate: number;
    groundingRate: number;
    fabricationRate: number | null;
  };
  evidence: {
    citationAccuracy: number | null;
    citationCompleteness: number | null;
    evidenceRelevance: number | null;
  };
  byCategory: Record<string, CategoryMetrics>;
  byCodebaseType: Record<string, CategoryMetrics>;
  byDifficulty: Record<string, CategoryMetrics>;
}

export interface CategoryMetrics {
  accuracy: number;
  sampleSize: number;
  confidenceInterval: [number, number];
}

export interface RegressionReport {
  hasRegression: boolean;
  regressions: RegressionEntry[];
  improvements: RegressionEntry[];
  recommendation: 'block' | 'warn' | 'pass';
}

export interface RegressionEntry {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  significance: 'significant' | 'marginal' | 'noise';
}

export interface EvalRunnerDependencies {
  pipeline: EvalPipeline;
  clock?: () => Date;
  runIdFactory?: () => string;
}

export const DEFAULT_EVAL_K_VALUES = [1, 3, 5, 10] as const;
const TARGET_K = 5;

// ============================================================================
// EVAL RUNNER
// ============================================================================

export class EvalRunner {
  private pipeline: EvalPipeline;
  private clock: () => Date;
  private runIdFactory: () => string;

  constructor(deps: EvalRunnerDependencies) {
    this.pipeline = deps.pipeline;
    this.clock = deps.clock ?? (() => new Date());
    this.runIdFactory = deps.runIdFactory ?? (() => `eval_${Date.now().toString(36)}`);
  }

  async evaluate(options: EvalOptions): Promise<EvalReport> {
    const startedAt = this.clock();
    const corpus = await loadEvalCorpus(options.corpusPath, options.corpusPaths);
    let filteredQueries = filterQueries(corpus.queries, options.queryFilter);

    if (typeof options.maxRepos === 'number' && Number.isFinite(options.maxRepos) && options.maxRepos > 0) {
      const allowed = new Set<string>();
      for (const query of filteredQueries) {
        if (allowed.size >= options.maxRepos) break;
        allowed.add(query.repoId);
      }
      filteredQueries = filteredQueries.filter((query) => allowed.has(query.repoId));
    }

    if (typeof options.maxQueries === 'number' && Number.isFinite(options.maxQueries) && options.maxQueries > 0) {
      filteredQueries = filteredQueries.slice(0, options.maxQueries);
    }

    const queryResults = await runWithConcurrency(
      filteredQueries,
      Math.max(1, options.parallel ?? 1),
      async (query) => {
        const repo = resolveRepoForQuery(corpus.repos, query);
        if (!repo) {
          return buildErroredResult(query, `Unknown repoId: ${query.repoId}`);
        }
        const repoRoot = resolveRepoRoot(corpus, query, repo, options.corpusPath);
        return this.evaluateSingleQuery(query, repo, repoRoot, options);
      }
    );

    const metrics = aggregateMetrics(queryResults, corpus.repos);
    const completedAt = this.clock();

    return {
      runId: this.runIdFactory(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      corpusVersion: corpus.version,
      options,
      queryCount: queryResults.length,
      metrics,
      queryResults,
    };
  }

  compareRuns(baseline: EvalReport, current: EvalReport): RegressionReport {
    const comparisons: Array<{
      key: string;
      baseline: number;
      current: number;
      higherIsBetter: boolean;
    }> = [
      {
        key: 'retrieval.recallAtK.5',
        baseline: baseline.metrics.retrieval.recallAtK[TARGET_K] ?? 0,
        current: current.metrics.retrieval.recallAtK[TARGET_K] ?? 0,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.precisionAtK.5',
        baseline: baseline.metrics.retrieval.precisionAtK[TARGET_K] ?? 0,
        current: current.metrics.retrieval.precisionAtK[TARGET_K] ?? 0,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.mrr',
        baseline: baseline.metrics.retrieval.mrr,
        current: current.metrics.retrieval.mrr,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.map',
        baseline: baseline.metrics.retrieval.map,
        current: current.metrics.retrieval.map,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.ndcg',
        baseline: baseline.metrics.retrieval.ndcg,
        current: current.metrics.retrieval.ndcg,
        higherIsBetter: true,
      },
      {
        key: 'synthesis.factRecall',
        baseline: baseline.metrics.synthesis.factRecall,
        current: current.metrics.synthesis.factRecall,
        higherIsBetter: true,
      },
      {
        key: 'synthesis.factPrecision',
        baseline: baseline.metrics.synthesis.factPrecision,
        current: current.metrics.synthesis.factPrecision,
        higherIsBetter: true,
      },
      {
        key: 'hallucination.hallucinationRate',
        baseline: baseline.metrics.hallucination.hallucinationRate,
        current: current.metrics.hallucination.hallucinationRate,
        higherIsBetter: false,
      },
    ];

    const regressions: RegressionEntry[] = [];
    const improvements: RegressionEntry[] = [];

    for (const metric of comparisons) {
      const delta = metric.current - metric.baseline;
      const significance = classifyDelta(delta);
      const regression = metric.higherIsBetter ? delta < 0 : delta > 0;
      const entry: RegressionEntry = {
        metric: metric.key,
        baseline: metric.baseline,
        current: metric.current,
        delta,
        significance,
      };

      if (regression && significance !== 'noise') {
        regressions.push(entry);
      } else if (!regression && significance !== 'noise') {
        improvements.push(entry);
      }
    }

    const hasRegression = regressions.length > 0;
    const blocking = regressions.some((entry) =>
      ['retrieval.recallAtK.5', 'hallucination.hallucinationRate'].includes(entry.metric) &&
      entry.significance === 'significant'
    );
    const recommendation = blocking ? 'block' : hasRegression ? 'warn' : 'pass';

    return {
      hasRegression,
      regressions,
      improvements,
      recommendation,
    };
  }

  async evaluateQuery(queryId: string, options: EvalOptions): Promise<QueryEvalResult> {
    const corpus = await loadEvalCorpus(options.corpusPath, options.corpusPaths);
    const query = corpus.queries.find((candidate) => candidate.queryId === queryId);
    if (!query) {
      throw new Error(`Eval query not found: ${queryId}`);
    }
    const repo = resolveRepoForQuery(corpus.repos, query);
    if (!repo) {
      throw new Error(`Eval query repo not found: ${query.repoId}`);
    }
    const repoRoot = resolveRepoRoot(corpus, query, repo, options.corpusPath);
    return this.evaluateSingleQuery(query, repo, repoRoot, options);
  }

  private async evaluateSingleQuery(
    query: GroundTruthQuery,
    repo: RepoManifest,
    repoRoot: string,
    options: EvalOptions
  ): Promise<QueryEvalResult> {
    const errors: string[] = [];
    let retrieval: RetrievalResult | undefined;
    let retrievalLatency: number | undefined;

    try {
      const start = this.clock();
      retrieval = await withTimeout(
        this.pipeline.retrieve({ query, repo, repoRoot }),
        options.timeoutMs
      );
      const end = this.clock();
      retrievalLatency = options.includeLatency
        ? retrieval.latencyMs ?? end.getTime() - start.getTime()
        : undefined;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const retrievalEval = evaluateRetrieval(query, repoRoot, retrieval, retrievalLatency);

    let synthesisEval: SynthesisEvalResult | undefined;
    if (retrieval && this.pipeline.synthesize) {
      try {
        const start = this.clock();
        const synthesis = await withTimeout(
          this.pipeline.synthesize({ query, repo, repoRoot, retrieval }),
          options.timeoutMs
        );
        const end = this.clock();
        const synthesisLatency = options.includeLatency
          ? synthesis.latencyMs ?? end.getTime() - start.getTime()
          : undefined;
        synthesisEval = evaluateSynthesis(query, synthesis, repoRoot, synthesisLatency);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const score = computeQueryScore(retrievalEval, synthesisEval);

    return {
      queryId: query.queryId,
      repoId: query.repoId,
      category: query.category,
      difficulty: query.difficulty,
      intent: query.intent,
      retrieval: retrievalEval,
      synthesis: synthesisEval,
      score,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

export function createEvalRunner(deps: EvalRunnerDependencies): EvalRunner {
  return new EvalRunner(deps);
}

// ============================================================================
// CORPUS LOADING
// ============================================================================

async function loadEvalCorpus(corpusPath: string, corpusPaths?: string[]): Promise<EvalCorpus> {
  const roots = resolveCorpusRoots(corpusPath, corpusPaths);

  const repos: RepoManifest[] = [];
  const queries: GroundTruthQuery[] = [];
  const sources: EvalCorpusSource[] = [];
  let version = '0.0.0';

  for (const root of roots) {
    const resolvedRoot = resolve(root);
    const corpusId = basename(resolvedRoot);
    sources.push({ id: corpusId, path: resolvedRoot });

    const reposRoot = join(resolvedRoot, 'repos');
    const repoEntries = await readdir(reposRoot, { withFileTypes: true });

    for (const entry of repoEntries) {
      if (!entry.isDirectory()) {
        if (!entry.isSymbolicLink()) continue;
        const linkedPath = join(reposRoot, entry.name);
        let linkedStat;
        try {
          linkedStat = await stat(linkedPath);
        } catch {
          continue;
        }
        if (!linkedStat.isDirectory()) continue;
      }
      const repoRoot = join(reposRoot, entry.name, '.librarian-eval');
      const manifest = await readJson<RepoManifest>(join(repoRoot, 'manifest.json'));
      const groundTruth = await readJson<{ version?: string; repoId?: string; queries?: GroundTruthQuery[] }>(
        join(repoRoot, 'ground-truth.json')
      );

      repos.push({ ...manifest, corpusId });

      if (groundTruth.version) {
        version = groundTruth.version;
      }

      for (const query of groundTruth.queries ?? []) {
        queries.push({
          ...query,
          repoId: query.repoId || manifest.repoId,
          corpusId: query.corpusId ?? corpusId,
        });
      }
    }
  }

  return { version, repos, queries, sources };
}

function resolveCorpusRoots(primary: string, extra?: string[]): string[] {
  const combined = [primary, ...(extra ?? [])].filter(Boolean);
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const item of combined) {
    const resolved = resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push(item);
  }
  return roots;
}

function resolveRepoForQuery(
  repos: RepoManifest[],
  query: GroundTruthQuery
): RepoManifest | undefined {
  if (query.corpusId) {
    return repos.find(
      (candidate) => candidate.repoId === query.repoId && candidate.corpusId === query.corpusId
    );
  }
  return repos.find((candidate) => candidate.repoId === query.repoId);
}

function resolveRepoRoot(
  corpus: EvalCorpus,
  query: GroundTruthQuery,
  repo: RepoManifest,
  fallbackCorpusPath: string
): string {
  const corpusId = query.corpusId ?? repo.corpusId;
  const source = corpus.sources.find((candidate) => candidate.id === corpusId);
  const corpusPath = source?.path ?? fallbackCorpusPath;
  return join(resolve(corpusPath), 'repos', repo.repoId);
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

// ============================================================================
// FILTERING
// ============================================================================

function filterQueries(
  queries: GroundTruthQuery[],
  filter?: EvalOptions['queryFilter']
): GroundTruthQuery[] {
  if (!filter) return queries;

  return queries.filter((query) => {
    if (filter.categories && !filter.categories.includes(query.category)) return false;
    if (filter.difficulties && !filter.difficulties.includes(query.difficulty)) return false;
    if (filter.repoIds && !filter.repoIds.includes(query.repoId)) return false;
    if (filter.queryIds && !filter.queryIds.includes(query.queryId)) return false;
    return true;
  });
}

// ============================================================================
// QUERY EVALUATION
// ============================================================================

function evaluateRetrieval(
  query: GroundTruthQuery,
  repoRoot: string,
  retrieval?: RetrievalResult,
  latencyMs?: number
): RetrievalEvalResult {
  const normalizeDoc = (docId: string): string => normalizeDocId(repoRoot, docId);

  const retrievedDocs = (retrieval?.docs ?? []).map(normalizeDoc);
  const mustInclude = unique((query.correctAnswer.mustIncludeFiles ?? []).map(normalizeDoc));
  const shouldInclude = unique((query.correctAnswer.shouldIncludeFiles ?? []).map(normalizeDoc));
  const relevantTargets = unique([...mustInclude, ...shouldInclude]);
  const metrics = computeRetrievalMetrics({
    retrievedDocs,
    relevantDocs: relevantTargets,
    kValues: DEFAULT_EVAL_K_VALUES,
  });

  const requiredRecall = mustInclude.length > 0
    ? mustInclude.filter((file) => retrievedDocs.includes(file)).length / mustInclude.length
    : 1;

  return {
    retrievedDocs,
    recallAtK: metrics.recallAtK,
    precisionAtK: metrics.precisionAtK,
    ndcgAtK: metrics.ndcgAtK,
    mrr: metrics.mrr,
    map: metrics.map,
    requiredRecall,
    latencyMs,
  };
}

function evaluateSynthesis(
  query: GroundTruthQuery,
  synthesis: SynthesisResult,
  repoRoot: string,
  latencyMs?: number
): SynthesisEvalResult {
  const claims = synthesis.claims && synthesis.claims.length > 0
    ? synthesis.claims
    : [];

  const citationAccuracy = computeCitationAccuracy({
    citations: synthesis.citations,
    evidenceRefs: query.correctAnswer.evidenceRefs ?? [],
    repoRoot,
  });

  const metrics = computeSynthesisMetrics({
    answer: synthesis.answer,
    claims,
    citations: synthesis.citations,
    mustIncludeFacts: query.correctAnswer.mustIncludeFacts,
    mustNotClaim: query.correctAnswer.mustNotClaim,
    summary: query.correctAnswer.summary,
    acceptableVariations: query.correctAnswer.acceptableVariations,
    category: query.category,
    citationVerification: {
      verifiedCitations: citationAccuracy.validCitations,
      verifiableCitations: citationAccuracy.verifiableCitations,
    },
  });

  return {
    answer: synthesis.answer,
    ...metrics,
    citationAccuracy: citationAccuracy.verifiableCitations > 0 ? citationAccuracy.accuracy : null,
    latencyMs,
  };
}

function computeQueryScore(
  retrieval: RetrievalEvalResult,
  synthesis?: SynthesisEvalResult
): number {
  const retrievalScore = retrieval.recallAtK[TARGET_K] ?? 0;
  if (!synthesis) return retrievalScore;
  return (retrievalScore + synthesis.factRecall) / 2;
}

function buildErroredResult(query: GroundTruthQuery, message: string): QueryEvalResult {
  const retrieval = evaluateRetrieval(query, '', { docs: [] }, undefined);
  return {
    queryId: query.queryId,
    repoId: query.repoId,
    category: query.category,
    difficulty: query.difficulty,
    intent: query.intent,
    retrieval,
    synthesis: undefined,
    score: 0,
    errors: [message],
  };
}

function normalizeDocId(repoRoot: string, docId: string): string {
  const raw = String(docId ?? '');
  if (raw.length === 0) return raw;

  if (repoRoot && isAbsolute(raw)) {
    const rel = relative(repoRoot, raw);
    if (!rel.startsWith('..')) {
      return rel.split(sep).join('/');
    }
  }

  return raw.split(sep).join('/');
}

// ============================================================================
// AGGREGATION
// ============================================================================

function aggregateMetrics(queryResults: QueryEvalResult[], repos: RepoManifest[]): EvalMetrics {
  const retrievalRecall: Record<number, number[]> = {};
  const retrievalPrecision: Record<number, number[]> = {};
  const retrievalNdcg: Record<number, number[]> = {};
  const retrievalMap: number[] = [];
  const retrievalMrr: number[] = [];

  const synthesisPrecision: number[] = [];
  const synthesisRecall: number[] = [];
  const synthesisSummary: number[] = [];
  const synthesisConsistency: number[] = [];
  const hallucinationRates: number[] = [];
  const groundingRates: number[] = [];
  const fabricationRates: number[] = [];
  const citationAccuracies: number[] = [];
  const synthesisStructural: number[] = [];
  const synthesisBehavioral: number[] = [];

  for (const result of queryResults) {
    retrievalMap.push(result.retrieval.map);
    retrievalMrr.push(result.retrieval.mrr);

    for (const k of DEFAULT_EVAL_K_VALUES) {
      const recall = result.retrieval.recallAtK[k] ?? 0;
      const precision = result.retrieval.precisionAtK[k] ?? 0;
      const ndcg = result.retrieval.ndcgAtK[k] ?? 0;

      if (!retrievalRecall[k]) retrievalRecall[k] = [];
      if (!retrievalPrecision[k]) retrievalPrecision[k] = [];
      if (!retrievalNdcg[k]) retrievalNdcg[k] = [];

      retrievalRecall[k].push(recall);
      retrievalPrecision[k].push(precision);
      retrievalNdcg[k].push(ndcg);
    }

    if (result.synthesis) {
      synthesisPrecision.push(result.synthesis.factPrecision);
      synthesisRecall.push(result.synthesis.factRecall);
      synthesisSummary.push(result.synthesis.summaryAccuracy);
      synthesisConsistency.push(result.synthesis.consistencyScore);
      hallucinationRates.push(result.synthesis.hallucinationRate);
      groundingRates.push(result.synthesis.groundingRate);
      if (result.synthesis.fabricationRate !== null) {
        fabricationRates.push(result.synthesis.fabricationRate);
      }
      if (result.synthesis.citationAccuracy !== null) {
        citationAccuracies.push(result.synthesis.citationAccuracy);
      }
      if (result.synthesis.structuralAccuracy !== undefined) {
        synthesisStructural.push(result.synthesis.structuralAccuracy);
      }
      if (result.synthesis.behavioralAccuracy !== undefined) {
        synthesisBehavioral.push(result.synthesis.behavioralAccuracy);
      }
    }
  }

  const meanRecall: Record<number, number> = {};
  const meanPrecision: Record<number, number> = {};

  for (const k of DEFAULT_EVAL_K_VALUES) {
    meanRecall[k] = mean(retrievalRecall[k] ?? []);
    meanPrecision[k] = mean(retrievalPrecision[k] ?? []);
  }

  const ndcgAtTarget = mean(retrievalNdcg[TARGET_K] ?? []);

  const retrieval = {
    recallAtK: meanRecall,
    precisionAtK: meanPrecision,
    mrr: mean(retrievalMrr),
    map: mean(retrievalMap),
    ndcg: ndcgAtTarget,
  };

  const synthesis = {
    factPrecision: mean(synthesisPrecision),
    factRecall: mean(synthesisRecall),
    summaryAccuracy: mean(synthesisSummary),
    consistencyScore: mean(synthesisConsistency),
    structuralAccuracy: mean(synthesisStructural),
    behavioralAccuracy: mean(synthesisBehavioral),
  };

  const hallucination = {
    hallucinationRate: mean(hallucinationRates),
    groundingRate: mean(groundingRates),
    fabricationRate: meanOrNull(fabricationRates),
  };

  const evidence = {
    citationAccuracy: meanOrNull(citationAccuracies),
    citationCompleteness: null,
    evidenceRelevance: null,
  };

  const byCategory = aggregateByKey(queryResults, (result) => result.category);
  const byDifficulty = aggregateByKey(queryResults, (result) => result.difficulty);
  const byCodebaseType = aggregateByKey(queryResults, (result) => {
    const repo = repos.find((candidate) => candidate.repoId === result.repoId);
    return repo?.annotationLevel ?? 'unknown';
  });

  return {
    retrieval,
    synthesis,
    hallucination,
    evidence,
    byCategory,
    byCodebaseType,
    byDifficulty,
  };
}

function aggregateByKey(
  queryResults: QueryEvalResult[],
  selector: (result: QueryEvalResult) => string
): Record<string, CategoryMetrics> {
  const grouped: Record<string, number[]> = {};

  for (const result of queryResults) {
    const key = selector(result);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(result.score);
  }

  const aggregates: Record<string, CategoryMetrics> = {};

  for (const [key, values] of Object.entries(grouped)) {
    const accuracy = mean(values);
    aggregates[key] = {
      accuracy,
      sampleSize: values.length,
      confidenceInterval: confidenceInterval(values),
    };
  }

  return aggregates;
}

// ============================================================================
// UTILITIES
// ============================================================================

async function runWithConcurrency<T, U>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  if (limit <= 1) {
    const results: U[] = [];
    for (let i = 0; i < items.length; i++) {
      results.push(await mapper(items[i], i));
    }
    return results;
  }

  const results = new Array<U>(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function mean(values: number[]): number {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanOrNull(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  return mean(values);
}

function confidenceInterval(values: number[]): [number, number] {
  if (!values || values.length === 0) return [0, 0];
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const margin = 1.96 * (std / Math.sqrt(values.length));
  return [clamp(avg - margin), clamp(avg + margin)];
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function classifyDelta(delta: number): 'significant' | 'marginal' | 'noise' {
  const magnitude = Math.abs(delta);
  if (magnitude >= 0.05) return 'significant';
  if (magnitude >= 0.01) return 'marginal';
  return 'noise';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
