#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TASKBANK_PATH = 'src/state/e2e/taskbank/default.json';
const DEFAULT_AGENTIC_REPORT_PATH = 'eval-results/agentic-use-case-review.json';
const DEFAULT_ARTIFACT_PATH = 'state/e2e/outcome-report.json';
const DEFAULT_MARKDOWN_PATH = 'state/e2e/outcome-report.md';
const DEFAULT_MAX_AGE_HOURS = 240;
const DEFAULT_MIN_NATURAL_TASKS = 20;
const DEFAULT_MIN_NATURAL_REPOS = 3;
const DEFAULT_MIN_PAIRED_TASKS = 10;
const DEFAULT_MIN_RELIABILITY_LIFT = 0;
const DEFAULT_MIN_TIME_REDUCTION = 0;
const DEFAULT_MIN_EVIDENCE_LINKED_PAIRS = 5;
const DEFAULT_MIN_AGENT_CRITIQUE_SHARE = 1;

class OutcomeHarnessFailure extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'OutcomeHarnessFailure';
    this.report = report;
  }
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${flagName} value "${value}"`);
  }
  return parsed;
}

async function discoverDefaultAbReports(root) {
  const evalDir = path.join(root, 'eval-results');
  const entries = await fs.readdir(evalDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^ab-harness-.*\.json$/i.test(name))
    .map((name) => path.join('eval-results', name))
    .sort();
  if (files.length > 0) return files;
  return ['eval-results/ab-harness-report.json'];
}

async function parseArgs(argv, root) {
  const options = {
    taskbank: DEFAULT_TASKBANK_PATH,
    agenticReport: DEFAULT_AGENTIC_REPORT_PATH,
    abReports: await discoverDefaultAbReports(root),
    artifact: DEFAULT_ARTIFACT_PATH,
    markdown: DEFAULT_MARKDOWN_PATH,
    strict: false,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    minNaturalTasks: DEFAULT_MIN_NATURAL_TASKS,
    minNaturalRepos: DEFAULT_MIN_NATURAL_REPOS,
    minPairedTasks: DEFAULT_MIN_PAIRED_TASKS,
    minReliabilityLift: DEFAULT_MIN_RELIABILITY_LIFT,
    minTimeReduction: DEFAULT_MIN_TIME_REDUCTION,
    minEvidenceLinkedPairs: DEFAULT_MIN_EVIDENCE_LINKED_PAIRS,
    minAgentCritiqueShare: DEFAULT_MIN_AGENT_CRITIQUE_SHARE,
  };
  let sawExplicitAbReport = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--taskbank') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --taskbank');
      options.taskbank = value;
      i += 1;
      continue;
    }
    if (arg === '--agentic-report') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --agentic-report');
      options.agenticReport = value;
      i += 1;
      continue;
    }
    if (arg === '--ab-report') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --ab-report');
      if (!sawExplicitAbReport) {
        options.abReports = [];
        sawExplicitAbReport = true;
      }
      options.abReports.push(value);
      i += 1;
      continue;
    }
    if (arg === '--artifact') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --artifact');
      options.artifact = value;
      i += 1;
      continue;
    }
    if (arg === '--markdown') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --markdown');
      options.markdown = value;
      i += 1;
      continue;
    }
    if (arg === '--max-age-hours') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --max-age-hours');
      options.maxAgeHours = parseNumber(value, '--max-age-hours');
      i += 1;
      continue;
    }
    if (arg === '--min-natural-tasks') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-natural-tasks');
      options.minNaturalTasks = parseNumber(value, '--min-natural-tasks');
      i += 1;
      continue;
    }
    if (arg === '--min-natural-repos') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-natural-repos');
      options.minNaturalRepos = parseNumber(value, '--min-natural-repos');
      i += 1;
      continue;
    }
    if (arg === '--min-paired-tasks') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-paired-tasks');
      options.minPairedTasks = parseNumber(value, '--min-paired-tasks');
      i += 1;
      continue;
    }
    if (arg === '--min-reliability-lift') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-reliability-lift');
      options.minReliabilityLift = parseNumber(value, '--min-reliability-lift');
      i += 1;
      continue;
    }
    if (arg === '--min-time-reduction') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-time-reduction');
      options.minTimeReduction = parseNumber(value, '--min-time-reduction');
      i += 1;
      continue;
    }
    if (arg === '--min-evidence-linked-pairs') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-evidence-linked-pairs');
      options.minEvidenceLinkedPairs = parseNumber(value, '--min-evidence-linked-pairs');
      i += 1;
      continue;
    }
    if (arg === '--min-agent-critique-share') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --min-agent-critique-share');
      options.minAgentCritiqueShare = parseNumber(value, '--min-agent-critique-share');
      i += 1;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.abReports.length === 0) {
    throw new Error('No AB report paths were provided');
  }
  return options;
}

async function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, payload) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function writeMarkdown(filePath, text) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, text, 'utf8');
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function median(values) {
  const filtered = values.filter((entry) => Number.isFinite(entry) && entry > 0).sort((a, b) => a - b);
  if (!filtered.length) return 0;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 0) {
    return (filtered[middle - 1] + filtered[middle]) / 2;
  }
  return filtered[middle];
}

function safeRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function calculateConfidenceInterval95(controlSuccesses, treatmentSuccesses, count) {
  if (!Number.isFinite(count) || count <= 0) {
    return { lower: 0, upper: 0 };
  }
  const controlRate = safeRate(controlSuccesses, count);
  const treatmentRate = safeRate(treatmentSuccesses, count);
  const delta = treatmentRate - controlRate;
  const pooled = safeRate(controlSuccesses + treatmentSuccesses, count * 2);
  const variance = pooled * (1 - pooled) * (2 / count);
  const margin = 1.96 * Math.sqrt(Math.max(variance, 0));
  return {
    lower: delta - margin,
    upper: delta + margin,
  };
}

function normalizeTaskbankTasks(taskbank) {
  const tasks = Array.isArray(taskbank?.tasks) ? taskbank.tasks : [];
  return tasks
    .map((task) => ({
      taskId: String(task?.taskId ?? task?.useCaseId ?? '').trim(),
      repo: String(task?.repo ?? '').trim(),
      complexity: String(task?.complexity ?? '').trim() || null,
      prompt: String(task?.prompt ?? task?.intent ?? '').trim() || null,
    }))
    .filter((task) => task.taskId.length > 0);
}

function normalizeAgenticResults(report) {
  const rows = Array.isArray(report?.results) ? report.results : [];
  return rows
    .map((row) => ({
      taskId: String(row?.useCaseId ?? row?.taskId ?? '').trim(),
      repo: String(row?.repo ?? row?.repository ?? '').trim(),
      success: Boolean(row?.success),
      strictSignals: Array.isArray(row?.strictSignals) ? row.strictSignals : [],
      evidenceCount: toFiniteNumber(row?.evidenceCount, 0),
    }))
    .filter((row) => row.taskId.length > 0);
}

function normalizeAbRows(report, sourcePath) {
  const rows = Array.isArray(report?.results) ? report.results : [];
  const sourceTimestamp = toIsoOrNull(report?.completedAt ?? report?.startedAt ?? report?.createdAt);
  return rows
    .map((row) => ({
      taskId: String(row?.taskId ?? '').trim(),
      workerType: String(row?.workerType ?? '').trim(),
      repo: String(row?.repo ?? '').trim(),
      complexity: String(row?.complexity ?? '').trim() || null,
      success: Boolean(row?.success),
      durationMs: toFiniteNumber(row?.durationMs, 0),
      agentCommandDurationMs: toFiniteNumber(row?.agentCommand?.durationMs, 0),
      artifacts: row?.artifacts ?? null,
      mode: String(row?.mode ?? '').trim(),
      agentCritiqueValid: row?.agentCritique?.valid === true,
      sourcePath,
      sourceTimestamp,
    }))
    .filter((row) => row.taskId.length > 0 && (row.workerType === 'control' || row.workerType === 'treatment'));
}

function summarizeNaturalTasks(taskbankTasks, agenticRows) {
  const agenticByTask = new Map();
  for (const row of agenticRows) {
    agenticByTask.set(row.taskId, row);
  }

  const selected = taskbankTasks.length > 0
    ? taskbankTasks.filter((task) => agenticByTask.has(task.taskId))
    : agenticRows.map((row) => ({ taskId: row.taskId, repo: row.repo }));

  const rows = selected.map((task) => agenticByTask.get(task.taskId)).filter(Boolean);
  const successCount = rows.filter((row) => row.success).length;
  const strictFailures = rows.filter((row) => row.strictSignals.length > 0).length;
  const repoSet = new Set(selected.map((task) => task.repo).filter(Boolean));
  const totalTasks = taskbankTasks.length > 0 ? taskbankTasks.length : agenticRows.length;
  const executedTasks = rows.length;
  return {
    total: totalTasks,
    executed: executedTasks,
    coverageRate: safeRate(executedTasks, totalTasks),
    successRate: safeRate(successCount, executedTasks),
    uniqueRepos: repoSet.size,
    strictFailureShare: safeRate(strictFailures, executedTasks),
  };
}

function pickEvidencePath(pair) {
  const treatmentArtifacts = pair.treatment?.artifacts;
  const candidate = treatmentArtifacts?.files?.result
    ?? treatmentArtifacts?.directory
    ?? pair.treatment?.sourcePath
    ?? null;
  if (!candidate || typeof candidate !== 'string') return null;
  return candidate;
}

function summarizePairs(abRows) {
  const newestByTaskAndWorker = new Map();
  for (const row of abRows) {
    const key = `${row.taskId}:${row.workerType}`;
    const existing = newestByTaskAndWorker.get(key);
    if (!existing) {
      newestByTaskAndWorker.set(key, row);
      continue;
    }
    const currentStamp = Date.parse(row.sourceTimestamp ?? '');
    const existingStamp = Date.parse(existing.sourceTimestamp ?? '');
    if (!Number.isNaN(currentStamp) && (Number.isNaN(existingStamp) || currentStamp > existingStamp)) {
      newestByTaskAndWorker.set(key, row);
    }
  }

  const pairs = [];
  const byTask = new Map();
  for (const row of newestByTaskAndWorker.values()) {
    const existing = byTask.get(row.taskId) ?? {};
    existing[row.workerType] = row;
    byTask.set(row.taskId, existing);
  }
  for (const [taskId, value] of byTask.entries()) {
    if (!value.control || !value.treatment) continue;
    pairs.push({
      taskId,
      repo: value.treatment.repo || value.control.repo || null,
      complexity: value.treatment.complexity || value.control.complexity || null,
      control: value.control,
      treatment: value.treatment,
    });
  }

  const controlSuccesses = pairs.filter((pair) => pair.control.success).length;
  const treatmentSuccesses = pairs.filter((pair) => pair.treatment.success).length;
  const latestRows = Array.from(newestByTaskAndWorker.values());
  const agentRuns = latestRows.filter((row) => row.mode === 'agent_command');
  const agentCritiqueReadyRuns = agentRuns.filter((row) => row.agentCritiqueValid === true).length;
  const controlDurations = pairs.map((pair) => pair.control.durationMs).filter((value) => value > 0);
  const treatmentDurations = pairs.map((pair) => pair.treatment.durationMs).filter((value) => value > 0);
  const controlAgentCommandDurations = pairs.map((pair) => pair.control.agentCommandDurationMs).filter((value) => value > 0);
  const treatmentAgentCommandDurations = pairs.map((pair) => pair.treatment.agentCommandDurationMs).filter((value) => value > 0);

  const medianControlDuration = median(controlDurations);
  const medianTreatmentDuration = median(treatmentDurations);
  const medianControlAgentCommandDuration = median(controlAgentCommandDurations);
  const medianTreatmentAgentCommandDuration = median(treatmentAgentCommandDurations);

  const durationChanges = pairs
    .map((pair) => ({
      taskId: pair.taskId,
      repo: pair.repo,
      durationDeltaMs: pair.control.durationMs - pair.treatment.durationMs,
      evidence: pickEvidencePath(pair),
      treatmentSuccess: pair.treatment.success,
      controlSuccess: pair.control.success,
    }))
    .sort((left, right) => right.durationDeltaMs - left.durationDeltaMs);

  const topWins = durationChanges.slice(0, 5);
  const topRegressions = durationChanges.slice(-5).reverse();
  const failureCases = durationChanges.filter((entry) => !entry.treatmentSuccess);
  const evidenceLinkedPairs = durationChanges.filter((entry) => typeof entry.evidence === 'string' && entry.evidence.length > 0).length;

  const pairedTasks = pairs.length;
  const controlSuccessRate = safeRate(controlSuccesses, pairedTasks);
  const treatmentSuccessRate = safeRate(treatmentSuccesses, pairedTasks);
  const reliabilityLift = treatmentSuccessRate - controlSuccessRate;
  const timeReduction = medianControlDuration > 0
    ? (medianControlDuration - medianTreatmentDuration) / medianControlDuration
    : 0;
  const agentCommandTimeReduction = medianControlAgentCommandDuration > 0
    ? (medianControlAgentCommandDuration - medianTreatmentAgentCommandDuration) / medianControlAgentCommandDuration
    : 0;

  return {
    pairedTasks,
    uniqueRepos: new Set(pairs.map((pair) => pair.repo).filter(Boolean)).size,
    controlSuccessRate,
    treatmentSuccessRate,
    reliabilityLift,
    timeReduction,
    agentCommandTimeReduction,
    confidenceInterval95: calculateConfidenceInterval95(controlSuccesses, treatmentSuccesses, pairedTasks),
    agentRuns: agentRuns.length,
    agentCritiqueShare: safeRate(agentCritiqueReadyRuns, agentRuns.length),
    topWins,
    topRegressions,
    failureCases,
    evidenceLinkedPairs,
  };
}

function summarizeFreshness(sourceTimestamps, maxAgeHours, now) {
  const ageBySourceHours = {};
  const failures = [];
  for (const [name, value] of Object.entries(sourceTimestamps)) {
    const stamp = toIsoOrNull(value);
    if (!stamp) {
      failures.push(`freshness:missing_timestamp:${name}`);
      ageBySourceHours[name] = null;
      continue;
    }
    const ageHours = (now.getTime() - new Date(stamp).getTime()) / (1000 * 60 * 60);
    ageBySourceHours[name] = Number(ageHours.toFixed(2));
    if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
      failures.push(`freshness:stale:${name}:${ageHours.toFixed(2)}h>${maxAgeHours}h`);
    }
  }
  return {
    maxAgeHours,
    ageBySourceHours,
    failures,
    satisfied: failures.length === 0,
  };
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# E2E Outcome Report');
  lines.push('');
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Created At: ${report.createdAt}`);
  lines.push(`- Strict Mode: ${report.strict ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Quantitative Scorecard');
  lines.push('');
  lines.push(`- Natural tasks: ${report.naturalTasks.executed}/${report.naturalTasks.total} (coverage ${(report.naturalTasks.coverageRate * 100).toFixed(1)}%)`);
  lines.push(`- Natural repos: ${report.naturalTasks.uniqueRepos}`);
  lines.push(`- Paired control/treatment tasks: ${report.controlVsTreatment.pairedTasks}`);
  lines.push(`- Agent-command critique share: ${(report.controlVsTreatment.agentCritiqueShare * 100).toFixed(1)}% (${report.controlVsTreatment.agentRuns} agent runs)`);
  lines.push(`- Reliability lift: ${(report.controlVsTreatment.reliabilityLift * 100).toFixed(2)}%`);
  lines.push(`- Time reduction: ${(report.controlVsTreatment.timeReduction * 100).toFixed(2)}%`);
  lines.push(`- Agent command time reduction: ${(report.controlVsTreatment.agentCommandTimeReduction * 100).toFixed(2)}%`);
  lines.push(`- 95% CI (reliability lift): [${(report.controlVsTreatment.confidenceInterval95.lower * 100).toFixed(2)}%, ${(report.controlVsTreatment.confidenceInterval95.upper * 100).toFixed(2)}%]`);
  lines.push('');
  lines.push('## Top Wins');
  lines.push('');
  if (report.controlVsTreatment.topWins.length === 0) {
    lines.push('- None');
  } else {
    for (const win of report.controlVsTreatment.topWins) {
      const evidence = win.evidence ? ` (evidence: ${win.evidence})` : '';
      lines.push(`- ${win.taskId} [${win.repo ?? 'unknown repo'}]: +${Math.round(win.durationDeltaMs)}ms${evidence}`);
    }
  }
  lines.push('');
  lines.push('## Top Regressions');
  lines.push('');
  if (report.controlVsTreatment.topRegressions.length === 0) {
    lines.push('- None');
  } else {
    for (const regression of report.controlVsTreatment.topRegressions) {
      const evidence = regression.evidence ? ` (evidence: ${regression.evidence})` : '';
      lines.push(`- ${regression.taskId} [${regression.repo ?? 'unknown repo'}]: ${Math.round(regression.durationDeltaMs)}ms${evidence}`);
    }
  }
  lines.push('');
  lines.push('## Disconfirmation');
  lines.push('');
  if (report.failures.length === 0) {
    lines.push('- No disconfirmation triggers were observed.');
  } else {
    for (const failure of report.failures) {
      lines.push(`- ${failure}`);
    }
  }
  lines.push('');
  lines.push('## Falsification Criteria');
  lines.push('');
  lines.push(`- Natural tasks < ${report.thresholds.minNaturalTasks}`);
  lines.push(`- Natural repos < ${report.thresholds.minNaturalRepos}`);
  lines.push(`- Paired control/treatment tasks < ${report.thresholds.minPairedTasks}`);
  lines.push(`- Reliability lift < ${report.thresholds.minReliabilityLift}`);
  lines.push(`- Time reduction < ${report.thresholds.minTimeReduction}`);
  lines.push(`- Freshness age > ${report.thresholds.maxAgeHours} hours`);
  lines.push(`- Evidence-linked paired tasks < ${report.thresholds.minEvidenceLinkedPairs}`);
  lines.push(`- Agent critique share < ${report.thresholds.minAgentCritiqueShare}`);
  lines.push('');
  lines.push('## Diagnoses');
  lines.push('');
  if (!Array.isArray(report.diagnoses) || report.diagnoses.length === 0) {
    lines.push('- None');
  } else {
    for (const diagnosis of report.diagnoses) {
      lines.push(`- ${diagnosis}`);
    }
  }
  lines.push('');
  lines.push('## Suggestions');
  lines.push('');
  if (!Array.isArray(report.suggestions) || report.suggestions.length === 0) {
    lines.push('- None');
  } else {
    for (const suggestion of report.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }
  lines.push('');
  lines.push('## Evidence Links');
  lines.push('');
  const evidenceLinks = report.controlVsTreatment.topWins
    .concat(report.controlVsTreatment.topRegressions)
    .map((entry) => entry.evidence)
    .filter((value, index, self) => typeof value === 'string' && value.length > 0 && self.indexOf(value) === index);
  if (evidenceLinks.length === 0) {
    lines.push('- None');
  } else {
    for (const evidence of evidenceLinks) {
      lines.push(`- ${evidence}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function buildOutcomeReport(options) {
  const taskbankJson = await readJson(options.taskbank);
  const agenticReportJson = await readJson(options.agenticReport);
  const abReportPayloads = [];
  for (const abReportPath of options.abReports) {
    const payload = await readJson(abReportPath).catch(() => null);
    if (payload) {
      abReportPayloads.push({ path: abReportPath, payload });
    }
  }
  if (abReportPayloads.length === 0) {
    throw new Error('No AB reports were readable');
  }

  const taskbankTasks = normalizeTaskbankTasks(taskbankJson);
  const agenticRows = normalizeAgenticResults(agenticReportJson);
  const abRows = abReportPayloads.flatMap(({ path: reportPath, payload }) => normalizeAbRows(payload, reportPath));
  const naturalTasks = summarizeNaturalTasks(taskbankTasks, agenticRows);
  const controlVsTreatment = summarizePairs(abRows);

  const sourceTimestamps = {
    agentic: toIsoOrNull(agenticReportJson?.createdAt),
    ab: toIsoOrNull(abReportPayloads[0]?.payload?.completedAt ?? abReportPayloads[0]?.payload?.startedAt ?? abReportPayloads[0]?.payload?.createdAt),
  };
  const freshness = summarizeFreshness(sourceTimestamps, options.maxAgeHours, new Date());

  const failures = [];
  if (naturalTasks.total < options.minNaturalTasks) {
    failures.push(`insufficient_natural_tasks:${naturalTasks.total}<${options.minNaturalTasks}`);
  }
  if (naturalTasks.uniqueRepos < options.minNaturalRepos) {
    failures.push(`insufficient_natural_repos:${naturalTasks.uniqueRepos}<${options.minNaturalRepos}`);
  }
  if (controlVsTreatment.pairedTasks < options.minPairedTasks) {
    failures.push(`insufficient_paired_tasks:${controlVsTreatment.pairedTasks}<${options.minPairedTasks}`);
  }
  if (controlVsTreatment.reliabilityLift < options.minReliabilityLift) {
    failures.push(`reliability_lift_below_threshold:${controlVsTreatment.reliabilityLift.toFixed(4)}<${options.minReliabilityLift}`);
  }
  if (controlVsTreatment.timeReduction < options.minTimeReduction) {
    failures.push(`time_reduction_below_threshold:${controlVsTreatment.timeReduction.toFixed(4)}<${options.minTimeReduction}`);
  }
  if (controlVsTreatment.evidenceLinkedPairs < options.minEvidenceLinkedPairs) {
    failures.push(`insufficient_evidence_links:${controlVsTreatment.evidenceLinkedPairs}<${options.minEvidenceLinkedPairs}`);
  }
  if (controlVsTreatment.agentCritiqueShare < options.minAgentCritiqueShare) {
    failures.push(
      `agent_critique_share_below_threshold:${controlVsTreatment.agentCritiqueShare.toFixed(4)}<${options.minAgentCritiqueShare}`
    );
  }
  failures.push(...freshness.failures);

  const diagnoses = [];
  const suggestions = [];
  if (controlVsTreatment.reliabilityLift < options.minReliabilityLift) {
    diagnoses.push(
      `Treatment reliability underperformed control (${(controlVsTreatment.reliabilityLift * 100).toFixed(2)}% lift).`
    );
    suggestions.push(
      'Inspect failed treatment tasks in failureCases evidence and harden retrieval correctness before publish.'
    );
    suggestions.push(
      'Run targeted AB reruns on failed tasks with stricter context-pack selection and verification hints.'
    );
  }
  if (controlVsTreatment.timeReduction > 0 && controlVsTreatment.reliabilityLift < 0) {
    diagnoses.push('Treatment is faster but less reliable, indicating a speed/correctness tradeoff regression.');
    suggestions.push('Prioritize correctness gates over latency for treatment path until reliability lift is non-negative.');
  }
  if (freshness.failures.length > 0) {
    diagnoses.push('Outcome evidence freshness is stale or missing.');
    suggestions.push('Refresh agentic-use-case and AB artifacts before rerunning strict outcome gate.');
  }
  if (controlVsTreatment.evidenceLinkedPairs < options.minEvidenceLinkedPairs) {
    diagnoses.push('Insufficient evidence-linked paired tasks reduces auditability.');
    suggestions.push('Increase paired tasks with artifact capture enabled to improve diagnostic confidence.');
  }
  if (controlVsTreatment.agentCritiqueShare < options.minAgentCritiqueShare) {
    diagnoses.push('External agent runs did not provide adequate structured critique coverage.');
    suggestions.push('Require critique JSON markers in agent prompt contract and reject runs with missing critique payloads.');
    suggestions.push('Expand critique rubric coverage across correctness, relevance, context quality, tooling friction, reliability, and productivity.');
  }
  if (diagnoses.length === 0) {
    diagnoses.push('No disqualifying diagnosis detected.');
    suggestions.push('Continue periodic cadence runs to monitor regressions.');
  }

  const status = failures.length === 0 ? 'passed' : 'failed';
  const report = {
    schema_version: 1,
    kind: 'E2EOutcomeReport.v1',
    status,
    strict: options.strict,
    createdAt: new Date().toISOString(),
    taskbankPath: options.taskbank,
    agenticReportPath: options.agenticReport,
    abReportPaths: options.abReports,
    naturalTasks,
    controlVsTreatment,
    freshness,
    thresholds: {
      maxAgeHours: options.maxAgeHours,
      minNaturalTasks: options.minNaturalTasks,
      minNaturalRepos: options.minNaturalRepos,
      minPairedTasks: options.minPairedTasks,
      minReliabilityLift: options.minReliabilityLift,
      minTimeReduction: options.minTimeReduction,
      minEvidenceLinkedPairs: options.minEvidenceLinkedPairs,
      minAgentCritiqueShare: options.minAgentCritiqueShare,
    },
    confirmDisconfirm: {
      confirmed: failures.length === 0,
      disconfirmed: failures.length > 0,
      reasons: failures,
    },
    diagnoses,
    suggestions,
    failures,
  };
  return report;
}

async function main() {
  const root = process.cwd();
  const options = await parseArgs(process.argv.slice(2), root);
  const report = await buildOutcomeReport(options);
  await writeJson(options.artifact, report);
  await writeMarkdown(options.markdown, buildMarkdownReport(report));

  if (report.status !== 'passed' && options.strict) {
    throw new OutcomeHarnessFailure(
      `Outcome harness failed strict thresholds: ${report.failures.join(', ')}`,
      report,
    );
  }
  if (report.status === 'passed') {
    console.log(`[test:e2e:outcome] passed (pairedTasks=${report.controlVsTreatment.pairedTasks}, naturalTasks=${report.naturalTasks.executed}/${report.naturalTasks.total})`);
  } else {
    console.log(`[test:e2e:outcome] failed (non-strict) reasons=${report.failures.join(',')}`);
  }
}

main().catch(async (error) => {
  const now = new Date().toISOString();
  let options;
  try {
    options = await parseArgs(process.argv.slice(2), process.cwd());
  } catch {
    options = {
      artifact: DEFAULT_ARTIFACT_PATH,
      markdown: DEFAULT_MARKDOWN_PATH,
      strict: false,
      maxAgeHours: DEFAULT_MAX_AGE_HOURS,
      minNaturalTasks: DEFAULT_MIN_NATURAL_TASKS,
      minNaturalRepos: DEFAULT_MIN_NATURAL_REPOS,
      minPairedTasks: DEFAULT_MIN_PAIRED_TASKS,
      minReliabilityLift: DEFAULT_MIN_RELIABILITY_LIFT,
      minTimeReduction: DEFAULT_MIN_TIME_REDUCTION,
      minEvidenceLinkedPairs: DEFAULT_MIN_EVIDENCE_LINKED_PAIRS,
      minAgentCritiqueShare: DEFAULT_MIN_AGENT_CRITIQUE_SHARE,
    };
  }
  const strictReport = error instanceof OutcomeHarnessFailure ? error.report : null;
  if (strictReport && typeof strictReport === 'object') {
    await writeJson(options.artifact, strictReport).catch(() => {});
    await writeMarkdown(options.markdown, buildMarkdownReport(strictReport)).catch(() => {});
  } else {
    const report = {
      schema_version: 1,
      kind: 'E2EOutcomeReport.v1',
      status: 'failed',
      strict: options.strict,
      createdAt: now,
      error: error instanceof Error ? error.message : String(error),
      thresholds: {
        maxAgeHours: options.maxAgeHours,
        minNaturalTasks: options.minNaturalTasks,
        minNaturalRepos: options.minNaturalRepos,
        minPairedTasks: options.minPairedTasks,
        minReliabilityLift: options.minReliabilityLift,
        minTimeReduction: options.minTimeReduction,
        minEvidenceLinkedPairs: options.minEvidenceLinkedPairs,
        minAgentCritiqueShare: options.minAgentCritiqueShare,
      },
      diagnoses: ['Harness execution error before report generation.'],
      suggestions: ['Check input artifact paths and JSON validity, then rerun.'],
      failures: [
        `execution_error:${error instanceof Error ? error.message : String(error)}`,
      ],
      naturalTasks: {
        total: 0,
        executed: 0,
        coverageRate: 0,
        successRate: 0,
        uniqueRepos: 0,
        strictFailureShare: 0,
      },
      controlVsTreatment: {
        pairedTasks: 0,
        uniqueRepos: 0,
        controlSuccessRate: 0,
        treatmentSuccessRate: 0,
        reliabilityLift: 0,
        timeReduction: 0,
        agentCommandTimeReduction: 0,
        confidenceInterval95: { lower: 0, upper: 0 },
        agentRuns: 0,
        agentCritiqueShare: 0,
        topWins: [],
        topRegressions: [],
        failureCases: [],
        evidenceLinkedPairs: 0,
      },
      freshness: {
        maxAgeHours: options.maxAgeHours,
        ageBySourceHours: {},
        failures: [`execution_error:${error instanceof Error ? error.message : String(error)}`],
        satisfied: false,
      },
    };
    await writeJson(options.artifact, report).catch(() => {});
    await writeMarkdown(options.markdown, buildMarkdownReport(report)).catch(() => {});
  }
  console.error('[test:e2e:outcome] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
