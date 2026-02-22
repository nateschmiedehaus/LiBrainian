import { parseArgs } from 'node:util';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  buildAbTaskUncertaintyScoresFromHistory,
  loadAbTasks,
  runAbExperiment,
  type AbWorkerType,
  type AbTaskSelectionMode,
  type AbEvidenceProfile,
  type ContextLevel,
  type AbTaskDefinition,
} from '../src/evaluation/ab_harness.js';
import { safeJsonParse } from '../src/utils/safe_json.js';

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseWorkers(value?: string): AbWorkerType[] | undefined {
  const items = parseList(value);
  if (!items) return undefined;
  const workers = items.filter((item) => item === 'control' || item === 'treatment') as AbWorkerType[];
  return workers.length > 0 ? workers : undefined;
}

function parseContextLevel(value?: string): ContextLevel | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if ([0, 1, 2, 3, 4, 5].includes(parsed)) {
    return parsed as ContextLevel;
  }
  return undefined;
}

function filterTasks(tasks: AbTaskDefinition[], repoFilter?: string[], taskIds?: string[]): AbTaskDefinition[] {
  let filtered = tasks;
  if (repoFilter && repoFilter.length > 0) {
    const repoSet = new Set(repoFilter);
    filtered = filtered.filter((task) => repoSet.has(task.repo));
  }
  if (taskIds && taskIds.length > 0) {
    const idSet = new Set(taskIds);
    filtered = filtered.filter((task) => idSet.has(task.id));
  }
  return filtered;
}

const args = parseArgs({
  options: {
    tasks: { type: 'string' },
    taskpack: { type: 'string', default: 'default' },
    reposRoot: { type: 'string', default: 'eval-corpus/external-repos' },
    out: { type: 'string', default: 'eval-results/ab-harness-report.json' },
    maxTasks: { type: 'string' },
    selectionMode: { type: 'string', default: 'sequential' },
    evidenceProfile: { type: 'string', default: 'custom' },
    uncertaintyHistoryPath: { type: 'string' },
    contextLevel: { type: 'string' },
    cloneMissing: { type: 'boolean', default: false },
    workers: { type: 'string' },
    repo: { type: 'string' },
    taskIds: { type: 'string' },
    timeoutMs: { type: 'string' },
    requireAgentCommandTasks: { type: 'boolean', default: true },
    minAgentCommandShare: { type: 'string' },
    minAgentVerifiedExecutionShare: { type: 'string' },
    minAgentCritiqueShare: { type: 'string' },
    minArtifactIntegrityShare: { type: 'string' },
    maxVerificationFallbackShare: { type: 'string' },
    minT3SuccessRateLift: { type: 'string' },
    minT3CeilingTimeReduction: { type: 'string' },
    disableT3CeilingTimeReduction: { type: 'boolean' },
    requireT3Significance: { type: 'boolean', default: false },
    requireNoCriticalFailures: { type: 'boolean', default: true },
    requireBaselineFailureForAgentTasks: { type: 'boolean', default: true },
  },
});

const taskpackMap: Record<string, string> = {
  default: 'eval-corpus/ab-harness/tasks.json',
  agentic: 'eval-corpus/ab-harness/tasks.agentic.json',
  'agentic-bugfix': 'eval-corpus/ab-harness/tasks.agentic_bugfix.json',
};
const requestedTaskpack = args.values.taskpack ?? 'default';
const selectedTaskpack = taskpackMap[requestedTaskpack];
if (!selectedTaskpack) {
  throw new Error(`invalid_taskpack:${requestedTaskpack}`);
}
const tasksPath = path.resolve(process.cwd(), args.values.tasks ?? selectedTaskpack);
const reposRoot = path.resolve(process.cwd(), args.values.reposRoot ?? 'eval-corpus/external-repos');
const outPath = path.resolve(process.cwd(), args.values.out ?? 'eval-results/ab-harness-report.json');
const maxTasks = parseNumber(args.values.maxTasks);
const selectionModeRaw = (args.values.selectionMode ?? 'sequential').trim().toLowerCase();
if (selectionModeRaw !== 'sequential' && selectionModeRaw !== 'uncertainty' && selectionModeRaw !== 'adaptive') {
  throw new Error(`invalid_selection_mode:${selectionModeRaw}`);
}
const selectionMode = selectionModeRaw as AbTaskSelectionMode;
const evidenceProfileRaw = (args.values.evidenceProfile ?? 'custom').trim().toLowerCase();
if (
  evidenceProfileRaw !== 'release'
  && evidenceProfileRaw !== 'quick'
  && evidenceProfileRaw !== 'reference'
  && evidenceProfileRaw !== 'custom'
) {
  throw new Error(`invalid_evidence_profile:${evidenceProfileRaw}`);
}
const evidenceProfile = evidenceProfileRaw as AbEvidenceProfile;
const contextLevel = parseContextLevel(args.values.contextLevel);
const workerTypes = parseWorkers(args.values.workers);
const repoFilter = parseList(args.values.repo);
const taskIds = parseList(args.values.taskIds);
const timeoutMs = parseNumber(args.values.timeoutMs);
const minAgentCommandShare = parseNumber(args.values.minAgentCommandShare) ?? 1;
const minAgentVerifiedExecutionShare = parseNumber(args.values.minAgentVerifiedExecutionShare) ?? 1;
const minAgentCritiqueShare = parseNumber(args.values.minAgentCritiqueShare) ?? 0;
const minArtifactIntegrityShare = parseNumber(args.values.minArtifactIntegrityShare) ?? 1;
const maxVerificationFallbackShare = parseNumber(args.values.maxVerificationFallbackShare) ?? 0;
const minT3SuccessRateLift = parseNumber(args.values.minT3SuccessRateLift) ?? 0.25;
const minT3CeilingTimeReduction = parseNumber(args.values.minT3CeilingTimeReduction);

const tasks = await loadAbTasks(tasksPath);
const filteredTasks = filterTasks(tasks, repoFilter, taskIds);
let uncertaintyScores: Map<string, number> | undefined;
if (selectionMode !== 'sequential' && args.values.uncertaintyHistoryPath) {
  try {
    const historyPath = path.resolve(process.cwd(), args.values.uncertaintyHistoryPath);
    const historyRaw = await readFile(historyPath, 'utf8');
    const historyParsed = safeJsonParse<unknown>(historyRaw);
    if (historyParsed.ok) {
      uncertaintyScores = buildAbTaskUncertaintyScoresFromHistory(historyParsed.value);
    }
  } catch {
    uncertaintyScores = new Map<string, number>();
  }
}

const report = await runAbExperiment({
  reposRoot,
  tasks: filteredTasks,
  workerTypes,
  maxTasks,
  selectionMode,
  evidenceProfile,
  uncertaintyScores,
  contextLevelOverride: contextLevel,
  cloneMissing: args.values.cloneMissing ?? false,
  commandTimeoutMs: timeoutMs,
  requireAgentCommandTasks: args.values.requireAgentCommandTasks ?? true,
  minAgentCommandShare,
  minAgentVerifiedExecutionShare,
  minAgentCritiqueShare,
  minArtifactIntegrityShare,
  maxVerificationFallbackShare,
  minT3SuccessRateLift,
  minT3CeilingTimeReduction,
  requireT3CeilingTimeReduction:
    args.values.disableT3CeilingTimeReduction === undefined
      ? undefined
      : !args.values.disableT3CeilingTimeReduction,
  requireT3Significance: args.values.requireT3Significance ?? false,
  requireNoCriticalFailures: args.values.requireNoCriticalFailures ?? true,
  requireBaselineFailureForAgentTasks: args.values.requireBaselineFailureForAgentTasks ?? false,
});

console.log(
  '[ab-harness] diagnostic lane only: AB control-vs-treatment is secondary evidence; full external natural-usage E2E is authoritative.'
);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`A/B harness report written to: ${outPath}`);
console.log(`Task selection mode: ${selectionMode}`);
console.log(`Evidence profile: ${evidenceProfile}`);
if (selectionMode !== 'sequential') {
  console.log(`Uncertainty scores loaded: ${uncertaintyScores?.size ?? 0}`);
}
if (report.lift) {
  const significance = report.lift.significance;
  const pValueText = significance.pValue === null ? 'n/a' : significance.pValue.toFixed(4);
  const nPerArmText = Number.isFinite(significance.nPerArm) ? String(significance.nPerArm) : 'n/a';
  const significanceText = significance.statisticallySignificant === null
    ? `inconclusive (${significance.inconclusiveReason ?? 'unknown'})`
    : (significance.statisticallySignificant ? 'significant' : 'not significant');
  const agentReductionText = typeof report.lift.agentCommandTimeReduction === 'number'
    ? `, ${(report.lift.agentCommandTimeReduction * 100).toFixed(1)}% agent-command time reduction`
    : '';
  console.log(
    `Overall lift: ${report.lift.successRateLift.toFixed(3)} success, `
    + `${(report.lift.timeReduction * 100).toFixed(1)}% time reduction, `
    + `${agentReductionText}`
    + `p=${pValueText}, n_per_arm=${nPerArmText} (${significanceText})`
  );
}
if (report.t3PlusLift) {
  const significance = report.t3PlusLift.significance;
  const pValueText = significance.pValue === null ? 'n/a' : significance.pValue.toFixed(4);
  const nPerArmText = Number.isFinite(significance.nPerArm) ? String(significance.nPerArm) : 'n/a';
  const significanceText = significance.statisticallySignificant === null
    ? `inconclusive (${significance.inconclusiveReason ?? 'unknown'})`
    : (significance.statisticallySignificant ? 'significant' : 'not significant');
  const agentReductionText = typeof report.t3PlusLift.agentCommandTimeReduction === 'number'
    ? `, ${(report.t3PlusLift.agentCommandTimeReduction * 100).toFixed(1)}% agent-command time reduction`
    : '';
  console.log(
    `T3+ lift: ${report.t3PlusLift.successRateLift.toFixed(3)} success, `
    + `${(report.t3PlusLift.timeReduction * 100).toFixed(1)}% time reduction, `
    + `${agentReductionText}`
    + `p=${pValueText}, n_per_arm=${nPerArmText} (${significanceText})`
  );
}
console.log(`AB gates: ${report.gates.passed ? 'passed' : 'failed'}`);
if (!report.gates.passed) {
  console.log(`AB gate reasons: ${report.gates.reasons.join(', ')}`);
  const sampleOnlyFailure = report.gates.reasons.length > 0
    && report.gates.reasons.every((reason) =>
      reason.includes('sample_insufficient')
      || reason.includes('lift_unavailable')
    );
  if (sampleOnlyFailure) {
    console.log('AB capability status: sample size is insufficient for significance; increase task count/repo coverage.');
  }
  process.exitCode = 1;
}
console.log(`Agent-command share: ${(report.diagnostics.agentCommandShare * 100).toFixed(1)}%`);
console.log(`Agent verified execution share: ${(report.diagnostics.agentVerifiedExecutionShare * 100).toFixed(1)}%`);
console.log(`Agent baseline-guard share: ${(report.diagnostics.agentBaselineGuardShare * 100).toFixed(1)}%`);
console.log(`Agent critique share: ${(report.diagnostics.agentCritiqueShare * 100).toFixed(1)}%`);
console.log(`Artifact integrity share: ${(report.diagnostics.artifactIntegrityShare * 100).toFixed(1)}%`);
console.log(`Verification fallback share: ${(report.diagnostics.verificationFallbackShare * 100).toFixed(1)}%`);
if (report.diagnostics.providerPreflight) {
  const preflight = report.diagnostics.providerPreflight;
  const llmState = preflight.llm.available
    ? `${preflight.llm.provider}:${preflight.llm.model}`
    : `unavailable (${preflight.llm.error ?? 'unknown'})`;
  const embeddingState = preflight.embedding.available
    ? `${preflight.embedding.provider}:${preflight.embedding.model}`
    : `unavailable (${preflight.embedding.error ?? 'unknown'})`;
  console.log(`Treatment provider preflight: ${preflight.ready ? 'ready' : 'not ready'}`);
  console.log(`  LLM: ${llmState}`);
  console.log(`  Embedding: ${embeddingState}`);
  if (preflight.reason) {
    console.log(`  Reason: ${preflight.reason}`);
  }
  if (preflight.remediationSteps.length > 0) {
    console.log(`  Remediation: ${preflight.remediationSteps.slice(0, 3).join(' | ')}`);
  }
}
if (Object.keys(report.diagnostics.failureReasons).length > 0) {
  console.log(`Failure reasons: ${JSON.stringify(report.diagnostics.failureReasons)}`);
}
if (Object.keys(report.diagnostics.criticalFailureReasons).length > 0) {
  console.log(`Critical failure reasons: ${JSON.stringify(report.diagnostics.criticalFailureReasons)}`);
}
