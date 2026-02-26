import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction, type Context } from '../types.js';

export type DogfoodRecommendation = 'apply_now' | 'observe_only' | 'no_op';
export type DogfoodOwnerSurface = 'storage' | 'query' | 'evaluation' | 'testing' | 'process' | 'docs' | 'ci' | 'general';

export interface DogfoodAutoLearnerInput {
  runDir?: string;
  workspaceRoot?: string;
  naturalUsageMetricsPath?: string;
  ablationReplayPath?: string;
  errorTaxonomyPath?: string;
  decisionTraceRoot?: string;
  maxInterventions?: number;
}

export interface DogfoodIntervention {
  id: string;
  title: string;
  recommendation: DogfoodRecommendation;
  ownerSurface: DogfoodOwnerSurface;
  confidence: number;
  score: number;
  rootCause: string;
  causalRationale: string;
  expectedMetricMovement: string[];
  evidence: string[];
  patchPlan: {
    files: string[];
    tests: string[];
    verificationCommands: string[];
  };
}

export interface DogfoodAutoLearnerOutput {
  kind: 'DogfoodAutoLearnerResult.v1';
  runDir: string;
  generatedAt: string;
  healthBand: 'healthy' | 'degraded';
  noOpReason?: string;
  applyNow: DogfoodIntervention[];
  observeOnly: DogfoodIntervention[];
  topInterventions: DogfoodIntervention[];
  markdownPlan: string;
}

interface DecisionTraceSignal {
  taskId: string;
  usedLibrarian: boolean;
  outputQuality: 'helpful' | 'partial' | 'not_helpful' | 'unknown';
  naturalFailure: boolean;
  modelPolicyFallback: boolean;
}

const THRESHOLDS = {
  used_librarian_rate: 0.70,
  success_lift_t3_plus: 0.25,
  use_decision_precision: 0.80,
  use_decision_recall: 0.75,
  unnecessary_query_rate: 0.20,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function parseCsvObjects(content: string): Array<Record<string, string>> {
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const header = rows[0] ?? [];
  const objects: Array<Record<string, string>> = [];
  for (const row of rows.slice(1)) {
    const object: Record<string, string> = {};
    for (let index = 0; index < header.length; index += 1) {
      const key = header[index];
      if (!key) continue;
      object[key] = row[index] ?? '';
    }
    objects.push(object);
  }
  return objects;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readCsvObjects(filePath: string): Promise<Array<Record<string, string>>> {
  const content = await readFile(filePath, 'utf8');
  return parseCsvObjects(content);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() || fileStat.isDirectory();
  } catch {
    return false;
  }
}

async function detectLatestRunDir(workspaceRoot: string): Promise<string | null> {
  const runsRoot = path.join(workspaceRoot, 'docs', 'librarian', 'evals', 'dogfood', 'm0_qualitative_runs');
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}Z$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    if (candidates.length === 0) return null;
    return path.join(runsRoot, candidates[0] as string);
  } catch {
    return null;
  }
}

function readWorkspaceRootFromContext(context?: Context<unknown>): string {
  const deps = context?.deps as Record<string, unknown> | undefined;
  const librarian = deps?.librarian as { workspaceRoot?: unknown; rootDir?: unknown } | undefined;
  if (typeof librarian?.workspaceRoot === 'string' && librarian.workspaceRoot.length > 0) {
    return librarian.workspaceRoot;
  }
  if (typeof librarian?.rootDir === 'string' && librarian.rootDir.length > 0) {
    return librarian.rootDir;
  }
  return process.cwd();
}

async function collectDecisionTraceSignals(decisionTraceRoot: string): Promise<DecisionTraceSignal[]> {
  const signals: DecisionTraceSignal[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== 'decision_trace.md') continue;

      const taskId = path.basename(path.dirname(absolute));
      const content = await readFile(absolute, 'utf8');
      const usedMatch = /used_librarian:\s*(yes|no)/i.exec(content);
      const qualityMatch = /output_quality:\s*(helpful|partial|not_helpful)/i.exec(content);
      const failureMatch = /natural_failure:\s*(yes|no)/i.exec(content);
      const modelPolicyFallback =
        /model policy provider not registered/i.test(content)
        || /fallback_model_policy_provider_missing/i.test(content)
        || /model_policy_provider_not_registered/i.test(content);

      signals.push({
        taskId,
        usedLibrarian: (usedMatch?.[1] ?? '').toLowerCase() === 'yes',
        outputQuality: ((qualityMatch?.[1] ?? 'unknown').toLowerCase() as DecisionTraceSignal['outputQuality']),
        naturalFailure: (failureMatch?.[1] ?? '').toLowerCase() === 'yes',
        modelPolicyFallback,
      });
    }
  }

  await walk(decisionTraceRoot);
  return signals.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

function interventionTemplate(params: {
  id: string;
  title: string;
  recommendation: DogfoodRecommendation;
  ownerSurface: DogfoodOwnerSurface;
  confidence: number;
  score: number;
  rootCause: string;
  causalRationale: string;
  expectedMetricMovement: string[];
  evidence: string[];
  files: string[];
  tests: string[];
}): DogfoodIntervention {
  return {
    id: params.id,
    title: params.title,
    recommendation: params.recommendation,
    ownerSurface: params.ownerSurface,
    confidence: Number(clamp01(params.confidence).toFixed(3)),
    score: Number(clamp01(params.score).toFixed(3)),
    rootCause: params.rootCause,
    causalRationale: params.causalRationale,
    expectedMetricMovement: params.expectedMetricMovement,
    evidence: params.evidence,
    patchPlan: {
      files: params.files,
      tests: params.tests,
      verificationCommands: ['npm run build', 'npm test -- --run'],
    },
  };
}

function scoreFromCount(count: number, base: number, slope: number): number {
  return clamp01(base + count * slope);
}

function toRecommendation(score: number): DogfoodRecommendation {
  if (score >= 0.75) return 'apply_now';
  if (score >= 0.35) return 'observe_only';
  return 'no_op';
}

function stableSort(interventions: DogfoodIntervention[]): DogfoodIntervention[] {
  return [...interventions].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function ensureTopThree(interventions: DogfoodIntervention[]): DogfoodIntervention[] {
  const output = [...interventions];
  const fallbackCatalog: DogfoodIntervention[] = [
    interventionTemplate({
      id: 'monitor-dogfood-trends',
      title: 'Monitor weekly natural-usage trend drift',
      recommendation: 'observe_only',
      ownerSurface: 'evaluation',
      confidence: 0.72,
      score: 0.42,
      rootCause: 'Limited intervention count in current artifact snapshot.',
      causalRationale: 'Trend monitoring prevents silent regressions when active failure classes are low-frequency.',
      expectedMetricMovement: ['stability_of_used_librarian_rate:+0.03'],
      evidence: ['artifact_gap:insufficient_ranked_interventions'],
      files: ['docs/librarian/evals/dogfood/m0_qualitative_summary.md'],
      tests: ['src/__tests__/dogfood_natural_usage_docs.test.ts'],
    }),
    interventionTemplate({
      id: 'tighten-decision-trace-quality',
      title: 'Tighten decision-trace quality checks',
      recommendation: 'observe_only',
      ownerSurface: 'process',
      confidence: 0.69,
      score: 0.39,
      rootCause: 'Decision traces can drift in structure over time.',
      causalRationale: 'Stable decision traces improve causal attribution and reduce noisy replay interpretation.',
      expectedMetricMovement: ['ablation_replay_consistency:+0.05'],
      evidence: ['artifact_type:decision_trace'],
      files: ['docs/librarian/evals/dogfood/m0_qualitative_protocol.md'],
      tests: ['src/__tests__/dogfood_natural_usage_docs.test.ts'],
    }),
  ];

  const existingIds = new Set(output.map((item) => item.id));
  for (const candidate of fallbackCatalog) {
    if (output.length >= 3) break;
    if (existingIds.has(candidate.id)) continue;
    output.push(candidate);
    existingIds.add(candidate.id);
  }
  return output;
}

function renderMarkdownPlan(runDir: string, interventions: DogfoodIntervention[], healthBand: 'healthy' | 'degraded', noOpReason?: string): string {
  const lines: string[] = [];
  lines.push('# Dogfood AutoLearner Plan');
  lines.push('');
  lines.push(`- run_dir: ${normalizePath(runDir)}`);
  lines.push(`- health_band: ${healthBand}`);
  if (noOpReason) {
    lines.push(`- no_op_reason: ${noOpReason}`);
  }
  lines.push('');
  lines.push('## Ranked Interventions');
  lines.push('');

  interventions.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.recommendation}] ${item.title} (${item.id})`);
    lines.push(`- owner_surface: ${item.ownerSurface}`);
    lines.push(`- confidence: ${item.confidence.toFixed(3)}`);
    lines.push(`- score: ${item.score.toFixed(3)}`);
    lines.push(`- root_cause: ${item.rootCause}`);
    lines.push(`- causal_rationale: ${item.causalRationale}`);
    lines.push(`- expected_metric_movement: ${item.expectedMetricMovement.join('; ')}`);
    lines.push(`- files: ${item.patchPlan.files.join(', ')}`);
    lines.push(`- tests: ${item.patchPlan.tests.join(', ')}`);
    lines.push('');
  });

  return lines.join('\n');
}

export function createDogfoodAutoLearnerConstruction(): Construction<
  DogfoodAutoLearnerInput,
  DogfoodAutoLearnerOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'dogfood-autolearner',
    name: 'Dogfood AutoLearner',
    description: 'Learns from dogfood artifacts and emits ranked interventions with restraint-aware recommendations.',
    async execute(input: DogfoodAutoLearnerInput, context?: Context<unknown>) {
      const workspaceRoot = input.workspaceRoot ?? readWorkspaceRootFromContext(context);
      const resolvedRunDir = input.runDir
        ? path.resolve(input.runDir)
        : await detectLatestRunDir(workspaceRoot);

      if (!resolvedRunDir) {
        throw new ConstructionError(
          'dogfood-autolearner could not resolve runDir. Provide input.runDir or ensure m0_qualitative_runs has at least one timestamped run.',
          'dogfood-autolearner',
        );
      }

      const runDir = resolvedRunDir;
      const naturalUsageMetricsPath = input.naturalUsageMetricsPath ?? path.join(runDir, 'natural_usage_metrics.csv');
      const ablationReplayPath = input.ablationReplayPath ?? path.join(runDir, 'ablation_replay.csv');
      const errorTaxonomyPath = input.errorTaxonomyPath ?? path.join(runDir, 'error_taxonomy.csv');
      const decisionTraceRoot = input.decisionTraceRoot ?? path.join(runDir, 'tasks');
      const maxInterventions = Math.max(3, Math.min(12, input.maxInterventions ?? 6));

      const naturalMetricsRows = await exists(naturalUsageMetricsPath)
        ? await readCsvObjects(naturalUsageMetricsPath)
        : [];
      const ablationRows = await exists(ablationReplayPath)
        ? await readCsvObjects(ablationReplayPath)
        : [];
      const errorRows = await exists(errorTaxonomyPath)
        ? await readCsvObjects(errorTaxonomyPath)
        : [];
      const traceSignals = await exists(decisionTraceRoot)
        ? await collectDecisionTraceSignals(decisionTraceRoot)
        : [];

      const metricMap = new Map<string, number>();
      for (const row of naturalMetricsRows) {
        const metric = row.metric;
        if (!metric) continue;
        const value = parseNumber(row.value);
        if (value === undefined) continue;
        metricMap.set(metric, value);
      }

      const aggregateAblation = ablationRows.find((row) => row.task_id?.toUpperCase() === 'AGGREGATE');
      const successLift = metricMap.get('success_lift_t3_plus') ?? parseNumber(aggregateAblation?.success_lift_t3_plus) ?? 0;
      const usedRate = metricMap.get('used_librarian_rate') ?? 0;
      const precision = metricMap.get('use_decision_precision') ?? 1;
      const recall = metricMap.get('use_decision_recall') ?? 1;
      const unnecessaryRate = metricMap.get('unnecessary_query_rate') ?? 0;

      const lockCount = errorRows
        .filter((row) => /lock/i.test(row.error_class ?? ''))
        .reduce((sum, row) => sum + (parseNumber(row.count) ?? 0), 0);
      const timeoutCount = errorRows
        .filter((row) => /timeout|no_output|stall/i.test(row.error_class ?? ''))
        .reduce((sum, row) => sum + (parseNumber(row.count) ?? 0), 0);
      const modelPolicyFallbackCountFromErrors = errorRows
        .filter((row) => /model[_-]?policy|fallback_model_policy_provider_missing|provider_not_registered/i.test(row.error_class ?? ''))
        .reduce((sum, row) => sum + (parseNumber(row.count) ?? 0), 0);
      const notHelpfulCount = traceSignals.filter((trace) => trace.outputQuality === 'not_helpful').length;
      const naturalFailureCount = traceSignals.filter((trace) => trace.naturalFailure).length;
      const modelPolicyFallbackCountFromTraces = traceSignals.filter((trace) => trace.modelPolicyFallback).length;
      const modelPolicyFallbackCount = modelPolicyFallbackCountFromErrors + modelPolicyFallbackCountFromTraces;

      const allMetricsHealthy =
        usedRate >= THRESHOLDS.used_librarian_rate
        && successLift >= THRESHOLDS.success_lift_t3_plus
        && precision >= THRESHOLDS.use_decision_precision
        && recall >= THRESHOLDS.use_decision_recall
        && unnecessaryRate <= THRESHOLDS.unnecessary_query_rate;
      const noSevereErrors = lockCount === 0 && timeoutCount === 0 && naturalFailureCount === 0;
      const healthBand: 'healthy' | 'degraded' = allMetricsHealthy && noSevereErrors ? 'healthy' : 'degraded';

      const interventions: DogfoodIntervention[] = [];

      if (lockCount > 0) {
        const score = scoreFromCount(lockCount, 0.80, 0.015);
        interventions.push(interventionTemplate({
          id: 'lock-contention-recovery-hardening',
          title: 'Harden lock contention recovery and stale-lock cleanup',
          recommendation: toRecommendation(score),
          ownerSurface: 'storage',
          confidence: 0.88,
          score,
          rootCause: 'Repeated storage lock failures in dogfood sessions.',
          causalRationale: `Detected ${lockCount} lock-related error(s); reducing lock contention should directly lower failed/blocked query attempts.`,
          expectedMetricMovement: ['used_librarian_rate:+0.05', 'success_lift_t3_plus:+0.06'],
          evidence: ['error_taxonomy:lock', `lock_count:${lockCount}`],
          files: ['src/storage/sqlite_storage.ts', 'src/utils/workspace_resolver.ts'],
          tests: ['src/__tests__/retrieval_quality.test.ts'],
        }));
      }

      if (timeoutCount > 0) {
        const score = scoreFromCount(timeoutCount, 0.78, 0.014);
        interventions.push(interventionTemplate({
          id: 'query-timeout-no-output-guardrails',
          title: 'Add bounded query-timeout/no-output guardrails',
          recommendation: toRecommendation(score),
          ownerSurface: 'query',
          confidence: 0.86,
          score,
          rootCause: 'Query timeout/no-output failures degrade natural adoption.',
          causalRationale: `Detected ${timeoutCount} timeout/no-output error(s); bounded fallback guidance and deterministic timeout messaging should reduce abandoned sessions.`,
          expectedMetricMovement: ['used_librarian_rate:+0.04', 'time_to_first_librarian_query_s_p50:-20'],
          evidence: ['error_taxonomy:timeout_or_no_output', `timeout_count:${timeoutCount}`],
          files: ['src/api/query.ts', 'src/cli/commands/query.ts'],
          tests: ['src/__tests__/retrieval_quality.test.ts'],
        }));
      }

      if (modelPolicyFallbackCount > 0) {
        const score = scoreFromCount(modelPolicyFallbackCount, 0.82, 0.02);
        interventions.push(interventionTemplate({
          id: 'register-model-policy-provider',
          title: 'Register model policy provider for dogfood and qualification runs',
          recommendation: toRecommendation(score),
          ownerSurface: 'process',
          confidence: 0.9,
          score,
          rootCause: 'Model policy fallback mode is active during dogfood query paths.',
          causalRationale: `Detected ${modelPolicyFallbackCount} fallback policy signal(s); fallback policy mode weakens qualification evidence and can degrade retrieval/model routing quality.`,
          expectedMetricMovement: ['policy_fallback_rate:-1.00', 'success_lift_t3_plus:+0.04'],
          evidence: [
            `model_policy_fallback_count:${modelPolicyFallbackCount}`,
            `model_policy_fallback_trace_count:${modelPolicyFallbackCountFromTraces}`,
            `model_policy_fallback_error_count:${modelPolicyFallbackCountFromErrors}`,
          ],
          files: ['src/adapters/model_policy.ts', 'src/api/query.ts', 'src/api/bootstrap.ts'],
          tests: ['src/constructions/processes/__tests__/dogfood_autolearner.test.ts'],
        }));
      }

      if (usedRate < THRESHOLDS.used_librarian_rate) {
        const gap = THRESHOLDS.used_librarian_rate - usedRate;
        const score = clamp01(0.62 + gap * 1.1);
        interventions.push(interventionTemplate({
          id: 'improve-intent-to-query-mapping',
          title: 'Improve intent-to-query mapping for real task wording',
          recommendation: toRecommendation(score),
          ownerSurface: 'process',
          confidence: 0.79,
          score,
          rootCause: 'Natural adoption is below target threshold.',
          causalRationale: `used_librarian_rate=${usedRate.toFixed(2)} below ${THRESHOLDS.used_librarian_rate.toFixed(2)} indicates discovery/friction gaps.`,
          expectedMetricMovement: ['used_librarian_rate:+0.10'],
          evidence: ['natural_usage_metrics:used_librarian_rate'],
          files: ['AGENTS.md', 'docs/librarian/evals/dogfood/natural_usage_query_patterns.md'],
          tests: ['src/__tests__/dogfood_natural_usage_docs.test.ts'],
        }));
      }

      if (successLift < THRESHOLDS.success_lift_t3_plus) {
        const gap = THRESHOLDS.success_lift_t3_plus - successLift;
        const score = clamp01(0.60 + gap * 1.2);
        interventions.push(interventionTemplate({
          id: 'raise-causal-usefulness-lift',
          title: 'Raise causal usefulness lift on T3+ tasks',
          recommendation: toRecommendation(score),
          ownerSurface: 'evaluation',
          confidence: 0.77,
          score,
          rootCause: 'Ablation replay indicates insufficient outcome lift.',
          causalRationale: `success_lift_t3_plus=${successLift.toFixed(2)} below ${THRESHOLDS.success_lift_t3_plus.toFixed(2)}; interventions should target decision-changing query quality.`,
          expectedMetricMovement: ['success_lift_t3_plus:+0.08', 'rework_reduction_t3_plus:+0.06'],
          evidence: ['ablation_replay:aggregate', 'natural_usage_metrics:success_lift_t3_plus'],
          files: ['src/evaluation/ab_harness.ts', 'docs/librarian/evals/dogfood/m0_qualitative_protocol.md'],
          tests: ['src/__tests__/ab_harness.test.ts'],
        }));
      }

      if (precision < THRESHOLDS.use_decision_precision || unnecessaryRate > THRESHOLDS.unnecessary_query_rate) {
        const score = clamp01(0.58 + Math.max(THRESHOLDS.use_decision_precision - precision, unnecessaryRate - THRESHOLDS.unnecessary_query_rate));
        interventions.push(interventionTemplate({
          id: 'tighten-restraint-nudges',
          title: 'Tighten restraint nudges to reduce low-value queries',
          recommendation: toRecommendation(score),
          ownerSurface: 'process',
          confidence: 0.75,
          score,
          rootCause: 'Use/skip decisions are drifting from target precision bands.',
          causalRationale: `precision=${precision.toFixed(2)}, unnecessary_query_rate=${unnecessaryRate.toFixed(2)}; restraint guidance should be sharpened in planning flow.`,
          expectedMetricMovement: ['use_decision_precision:+0.06', 'unnecessary_query_rate:-0.08'],
          evidence: ['natural_usage_metrics:restraint'],
          files: ['AGENTS.md', 'docs/librarian/evals/dogfood/m0_qualitative_protocol.md'],
          tests: ['src/__tests__/dogfood_natural_usage_docs.test.ts'],
        }));
      }

      if (notHelpfulCount > 0) {
        const score = scoreFromCount(notHelpfulCount, 0.44, 0.03);
        interventions.push(interventionTemplate({
          id: 'improve-query-relevance-for-process-intents',
          title: 'Improve query relevance for process/meta intents',
          recommendation: toRecommendation(score),
          ownerSurface: 'query',
          confidence: 0.72,
          score,
          rootCause: 'Decision traces show not-helpful outputs for process-level intents.',
          causalRationale: `${notHelpfulCount} decision trace(s) flagged not_helpful output quality, indicating semantic routing gaps.`,
          expectedMetricMovement: ['time_to_first_librarian_query_s_p50:-15', 'success_lift_t3_plus:+0.04'],
          evidence: ['decision_traces:output_quality_not_helpful'],
          files: ['src/api/query.ts', 'src/query/relevance.ts'],
          tests: ['src/__tests__/retrieval_quality.test.ts'],
        }));
      }

      let noOpReason: string | undefined;
      if (healthBand === 'healthy') {
        const noOp = interventionTemplate({
          id: 'healthy-band-no-op',
          title: 'Metrics are in healthy band; no immediate intervention',
          recommendation: 'no_op',
          ownerSurface: 'general',
          confidence: 0.93,
          score: 0.2,
          rootCause: 'Natural-usage, causal lift, and restraint metrics are currently healthy with no severe failure signals.',
          causalRationale: 'Applying additional interventions now risks ceremonial over-optimization without measurable lift.',
          expectedMetricMovement: ['maintain_current_band'],
          evidence: ['natural_usage_metrics:healthy_band', 'error_taxonomy:low_or_zero_severe_errors'],
          files: ['docs/librarian/evals/dogfood/m0_qualitative_summary.md'],
          tests: ['src/__tests__/dogfood_natural_usage_docs.test.ts'],
        });
        interventions.push(noOp);
        noOpReason = noOp.rootCause;
      }

      const ranked = ensureTopThree(stableSort(interventions)).slice(0, maxInterventions);
      const applyNow = ranked.filter((item) => item.recommendation === 'apply_now');
      const observeOnly = ranked.filter((item) => item.recommendation === 'observe_only');
      const markdownPlan = renderMarkdownPlan(runDir, ranked, healthBand, noOpReason);

      return ok<DogfoodAutoLearnerOutput, ConstructionError>({
        kind: 'DogfoodAutoLearnerResult.v1',
        runDir: normalizePath(runDir),
        generatedAt: new Date().toISOString(),
        healthBand,
        noOpReason,
        applyNow,
        observeOnly,
        topInterventions: ranked,
        markdownPlan,
      });
    },
  };
}
