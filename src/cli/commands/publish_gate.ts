import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

export interface PublishGateCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export interface PublishGateIssue {
  id: string;
  scope: 'summary' | 'tasks' | 'metrics' | 'files';
  status: string;
  severity: 'blocking' | 'warning';
  count?: number;
  message: string;
  hint?: string;
}

export type PublishGateProfile = 'broad' | 'release';

export interface PublishGateSignal {
  id: string;
  path: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  hint?: string;
  ageHours?: number;
}

export interface PublishGateReport {
  schema: 'PublishReadinessReport.v1';
  createdAt: string;
  workspace: string;
  profile: PublishGateProfile;
  files: {
    gatesFile: string;
    statusFile: string;
  };
  passed: boolean;
  blockers: PublishGateIssue[];
  warnings: PublishGateIssue[];
  summary: {
    blockerCount: number;
    warningCount: number;
  };
  release?: {
    maxArtifactAgeHours: number;
    signals: PublishGateSignal[];
  };
}

interface GatesFile {
  summary?: Record<string, Record<string, number>>;
  tasks?: Record<string, { status?: string }>;
}

const PASSING_SUMMARY_STATUSES = new Set(['pass']);
const WARNING_SUMMARY_STATUSES = new Set(['skip_when_unavailable']);
const BLOCKING_TASK_STATUSES = new Set([
  'unverified',
  'pending',
  'not_started',
  'not_implemented',
  'fail',
  'invalid',
  'queued',
  'not_measured',
  'requires_providers',
  'skip_when_unavailable',
]);
const RELEASE_BLOCKING_METRICS = new Set([
  'retrieval recall@5',
  'context precision',
  'hallucination rate',
  'faithfulness',
  'answer relevancy',
  'a/b lift',
]);
const RELEASE_MIN_T3_LIFT = 0.25;
const RELEASE_MIN_T3_TIME_REDUCTION = 0.01;
const RELEASE_MIN_AB_AGENT_COMMAND_SHARE = 1;
const RELEASE_MIN_AB_AGENT_VERIFIED_EXECUTION_SHARE = 1;
const RELEASE_MIN_AB_ARTIFACT_INTEGRITY_SHARE = 1;
const RELEASE_MAX_AB_VERIFICATION_FALLBACK_SHARE = 0;
const RELEASE_MIN_LIVE_FIRE_RUNS = 2;
const RELEASE_MIN_EXTERNAL_SMOKE_REPOS = 3;
const RELEASE_MIN_EXTERNAL_SMOKE_LANGUAGES = 3;
const RELEASE_TARGET_EXTERNAL_SMOKE_LANGUAGES = 20;
const RELEASE_MIN_USE_CASE_REPOS = 4;
const RELEASE_MIN_USE_CASE_PASS_RATE = 0.75;
const RELEASE_MIN_USE_CASE_EVIDENCE_RATE = 0.9;
const RELEASE_MIN_USE_CASE_USEFUL_SUMMARY_RATE = 0.8;
const RELEASE_MAX_USE_CASE_STRICT_FAILURE_SHARE = 0;
const RELEASE_MIN_USE_CASE_PREREQUISITE_PASS_RATE = 0.75;
const RELEASE_MIN_USE_CASE_TARGET_PASS_RATE = 0.75;
const RELEASE_MIN_USE_CASE_TARGET_DEPENDENCY_READY_SHARE = 1;
const RELEASE_ALLOWED_USE_CASE_SELECTION_MODES = new Set(['balanced', 'probabilistic']);
const RELEASE_MIN_FINAL_VERIFICATION_SAMPLES = 6;
const RELEASE_REQUIRED_SIGNAL_IDS = [
  'release.live_fire_quick',
  'release.ab_agentic_bugfix',
  'release.agentic_use_case_review',
  'release.external_smoke_sample',
  'release.testing_discipline',
  'release.testing_tracker',
  'release.final_verification',
  'release.conversation_insights_review',
] as const;

const STRICT_FAILURE_MARKERS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'unverified_by_trace', pattern: /\bunverified_by_trace\(/i },
  { label: 'verification_fallback_share_above_threshold', pattern: /\bverification_fallback_share_above_threshold:/i },
  { label: 'fallback_context_file_selection', pattern: /\bfallback_context_file_selection\b/i },
  { label: 'journey_fallback_context_detected', pattern: /\bjourney_fallback_context_detected\b/i },
  { label: 'provider_unavailable', pattern: /provider_unavailable/i },
  { label: 'validation_unavailable', pattern: /validation_unavailable/i },
  { label: 'journey_unverified_trace_detected', pattern: /\bjourney_unverified_trace_detected\b/i },
];
const IMPERFECTION_KEY_PATTERN = /(fallback|retry|degrad|unverified|unavailable|timeout|error|failure|failed|inconclusive|skip(?:ped)?)/i;
const IMPERFECTION_VALUE_PATTERN = /(fallback|retry|retried|degrad|unverified|provider_unavailable|timeout|error|fail(?:ed|ure)?|inconclusive|skip(?:ped)?)/i;
const IMPERFECTION_SCAN_SKIP_KEYS = new Set([
  'stdout',
  'stderr',
  'output',
  'logs',
  'log',
  'prompt',
  'transcript',
  'raw',
  'text',
  'message',
  'notes',
  'detail',
  'details',
  'description',
  'command',
  'verificationpolicy',
  'thresholds',
]);
const REQUIRED_CONVERSATION_INSIGHTS_HEADINGS = [
  'Context Snapshot',
  'Non-Negotiable Product Signals',
  'Agent Failure Modes Observed',
  'OpenClaw Patterns to Borrow (Mapped to LiBrainian files)',
  'Action Items',
  'Accepted Wording for Positioning',
  'Deferred Ideas',
  'Evidence Links',
];
const CONVERSATION_INSIGHTS_REVIEW_TOKEN = 'conversation_insights_review_complete';
const CONVERSATION_NO_FALLBACK_TOKEN = 'zero_fallback_retry_degraded_confirmed';

interface ReleaseSignalPathOverrides {
  liveFirePointerPath?: string;
  abReportPath?: string;
  useCaseReportPath?: string;
  externalSmokeReportPath?: string;
  testingDisciplineReportPath?: string;
  testingTrackerReportPath?: string;
  finalVerificationReportPath?: string;
  conversationInsightsPath?: string;
}

function resolveExpectedExternalReposRoot(workspace: string): string {
  return path.resolve(workspace, 'eval-corpus', 'external-repos');
}

function normalizeAbsolutePath(value: string): string {
  return path.resolve(value);
}

function normalizeMetricName(metric: string): string {
  return metric.trim().toLowerCase();
}

function detectStrictMarkers(value: unknown): string[] {
  const serialized = JSON.stringify(value);
  return STRICT_FAILURE_MARKERS
    .filter((marker) => marker.pattern.test(serialized))
    .map((marker) => marker.label);
}

function valueSignalsImperfection(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return IMPERFECTION_VALUE_PATTERN.test(value);
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function formatImperfectionValue(value: unknown): string {
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim();
    const truncated = compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
    return JSON.stringify(truncated);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[length=${value.length}]`;
  return '[value]';
}

function isBenignImperfectionSignal(path: string, key: string, value: unknown): boolean {
  const normalizedPath = path.toLowerCase();
  const normalizedKey = key.toLowerCase();
  const inOptions =
    normalizedPath === 'options'
    || normalizedPath.startsWith('options.')
    || normalizedPath.includes('.options.');
  const isTimeoutConfiguration =
    normalizedKey === 'timeout'
    || normalizedKey === 'timeout_ms'
    || normalizedKey.endsWith('timeoutms');
  return inOptions && isTimeoutConfiguration && typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function collectImperfectionSignals(value: unknown): string[] {
  const findings: string[] = [];

  const visit = (node: unknown, currentPath: string): void => {
    if (findings.length >= 6) return;
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        visit(node[i], `${currentPath}[${i}]`);
        if (findings.length >= 6) break;
      }
      return;
    }

    for (const [rawKey, child] of Object.entries(node)) {
      if (findings.length >= 6) break;
      const key = String(rawKey);
      const loweredKey = key.toLowerCase();
      const nextPath = currentPath.length > 0 ? `${currentPath}.${key}` : key;

      if (
        IMPERFECTION_KEY_PATTERN.test(loweredKey)
        && valueSignalsImperfection(child)
        && !isBenignImperfectionSignal(nextPath, loweredKey, child)
      ) {
        findings.push(`${nextPath}=${formatImperfectionValue(child)}`);
      }

      if (!IMPERFECTION_SCAN_SKIP_KEYS.has(loweredKey)) {
        visit(child, nextPath);
      }
    }
  };

  visit(value, '');
  return findings;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMissingMarkdownHeadings(markdown: string, headings: string[]): string[] {
  return headings.filter((heading) => {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm');
    return !pattern.test(markdown);
  });
}

function collectBroadIssues(input: {
  gates: GatesFile;
  statusMarkdown: string;
}): { blockers: PublishGateIssue[]; warnings: PublishGateIssue[] } {
  const blockers: PublishGateIssue[] = [];
  const warnings: PublishGateIssue[] = [];
  const summary = input.gates.summary ?? {};

  for (const [layer, counts] of Object.entries(summary)) {
    for (const [status, count] of Object.entries(counts ?? {})) {
      if (status === 'total' || !Number.isFinite(count) || count <= 0) continue;
      if (PASSING_SUMMARY_STATUSES.has(status)) continue;
      const issue: PublishGateIssue = {
        id: `summary.${layer}.${status}`,
        scope: 'summary',
        status,
        severity: WARNING_SUMMARY_STATUSES.has(status) ? 'warning' : 'blocking',
        count,
        message: `${layer} has ${count} items with status "${status}"`,
        hint: 'Resolve gate status drift before publish.',
      };
      if (issue.severity === 'blocking') blockers.push(issue);
      else warnings.push(issue);
    }
  }

  const taskStatuses = summarizeTaskStatuses(input.gates.tasks ?? {});
  for (const [status, count] of Object.entries(taskStatuses)) {
    if (!BLOCKING_TASK_STATUSES.has(status) || count <= 0) continue;
    blockers.push({
      id: `tasks.${status}`,
      scope: 'tasks',
      status,
      severity: 'blocking',
      count,
      message: `${count} tasks are currently "${status}"`,
      hint: 'Do not publish while critical task statuses remain unresolved.',
    });
  }

  const notMetMetrics = parseNotMetMetrics(input.statusMarkdown);
  for (const metric of notMetMetrics) {
    blockers.push({
      id: `metrics.${metric.replace(/\s+/g, '_').toLowerCase()}`,
      scope: 'metrics',
      status: 'NOT MET',
      severity: 'blocking',
      message: `Metric target not met: ${metric}`,
      hint: 'Close this metric gap or change the target with explicit evidence.',
    });
  }

  return { blockers, warnings };
}

async function evaluateJsonSignal(input: {
  id: string;
  filePath: string;
  maxArtifactAgeHours: number;
  evaluate: (value: unknown) => { ok: boolean; message: string; hint?: string } | Promise<{ ok: boolean; message: string; hint?: string }>;
}): Promise<PublishGateSignal> {
  try {
    const [raw, fileStats] = await Promise.all([
      readFile(input.filePath, 'utf8'),
      stat(input.filePath),
    ]);
    const ageHours = (Date.now() - fileStats.mtimeMs) / (1000 * 60 * 60);
    if (ageHours > input.maxArtifactAgeHours) {
      return {
        id: input.id,
        path: input.filePath,
        status: 'fail',
        message: `Artifact is stale (${ageHours.toFixed(1)}h old)`,
        hint: `Re-run this evidence command within ${input.maxArtifactAgeHours}h of publish.`,
        ageHours,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        id: input.id,
        path: input.filePath,
        status: 'fail',
        message: 'Artifact is not valid JSON',
        hint: 'Re-run the command that produces this artifact.',
        ageHours,
      };
    }
    const verdict = await input.evaluate(parsed);
    return {
      id: input.id,
      path: input.filePath,
      status: verdict.ok ? 'pass' : 'fail',
      message: verdict.message,
      hint: verdict.hint,
      ageHours,
    };
  } catch {
    return {
      id: input.id,
      path: input.filePath,
      status: 'fail',
      message: 'Required artifact is missing',
      hint: 'Run the corresponding evaluation command to generate this artifact.',
    };
  }
}

async function evaluateMarkdownSignal(input: {
  id: string;
  filePath: string;
  maxArtifactAgeHours: number;
  evaluate: (markdown: string) => { ok: boolean; message: string; hint?: string };
}): Promise<PublishGateSignal> {
  try {
    const [raw, fileStats] = await Promise.all([
      readFile(input.filePath, 'utf8'),
      stat(input.filePath),
    ]);
    const ageHours = (Date.now() - fileStats.mtimeMs) / (1000 * 60 * 60);
    if (ageHours > input.maxArtifactAgeHours) {
      return {
        id: input.id,
        path: input.filePath,
        status: 'fail',
        message: `Artifact is stale (${ageHours.toFixed(1)}h old)`,
        hint: `Re-run this evidence command within ${input.maxArtifactAgeHours}h of publish.`,
        ageHours,
      };
    }

    const verdict = input.evaluate(raw);
    return {
      id: input.id,
      path: input.filePath,
      status: verdict.ok ? 'pass' : 'fail',
      message: verdict.message,
      hint: verdict.hint,
      ageHours,
    };
  } catch {
    return {
      id: input.id,
      path: input.filePath,
      status: 'fail',
      message: 'Required artifact is missing',
      hint: 'Create or refresh the required artifact before publish.',
    };
  }
}

async function collectReleaseSignals(input: {
  workspace: string;
  maxArtifactAgeHours: number;
  overrides?: ReleaseSignalPathOverrides;
}): Promise<PublishGateSignal[]> {
  const liveFirePointerPath = input.overrides?.liveFirePointerPath
    ? path.resolve(input.overrides.liveFirePointerPath)
    : path.join(input.workspace, 'state', 'eval', 'live-fire', 'hardcore', 'latest.json');
  const abReportPath = input.overrides?.abReportPath
    ? path.resolve(input.overrides.abReportPath)
    : path.join(input.workspace, 'eval-results', 'ab-harness-report.json');
  const useCaseReportPath = input.overrides?.useCaseReportPath
    ? path.resolve(input.overrides.useCaseReportPath)
    : path.join(input.workspace, 'eval-results', 'agentic-use-case-review.json');
  const externalSmokeReportPath = input.overrides?.externalSmokeReportPath
    ? path.resolve(input.overrides.externalSmokeReportPath)
    : path.join(input.workspace, 'state', 'eval', 'smoke', 'external', 'all-repos', 'report.json');
  const testingDisciplineReportPath = input.overrides?.testingDisciplineReportPath
    ? path.resolve(input.overrides.testingDisciplineReportPath)
    : path.join(input.workspace, 'state', 'eval', 'testing-discipline', 'report.json');
  const testingTrackerReportPath = input.overrides?.testingTrackerReportPath
    ? path.resolve(input.overrides.testingTrackerReportPath)
    : path.join(input.workspace, 'state', 'eval', 'testing-discipline', 'testing-tracker.json');
  const finalVerificationReportPath = input.overrides?.finalVerificationReportPath
    ? path.resolve(input.overrides.finalVerificationReportPath)
    : path.join(input.workspace, 'eval-results', 'final-verification.json');
  const conversationInsightsPath = input.overrides?.conversationInsightsPath
    ? path.resolve(input.overrides.conversationInsightsPath)
    : path.join(input.workspace, 'docs', 'librarian', 'CONVERSATION_INSIGHTS.md');
  const expectedReposRoot = resolveExpectedExternalReposRoot(input.workspace);

  return Promise.all([
    evaluateJsonSignal({
      id: 'release.live_fire_quick',
      filePath: liveFirePointerPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: async (value) => {
        const pointer = value as {
          schema?: string;
          reportPath?: string | null;
        };
        let reportValue: unknown = value;
        if (pointer?.schema === 'LiveFireLatestPointer.v1') {
          if (typeof pointer.reportPath !== 'string' || pointer.reportPath.trim().length === 0) {
            return {
              ok: false,
              message: 'Live-fire pointer is missing reportPath',
              hint: 'Run live-fire with `--output <path>` so publish gating can validate the full run artifact.',
            };
          }
          const resolvedReportPath = path.isAbsolute(pointer.reportPath)
            ? pointer.reportPath
            : path.resolve(path.dirname(liveFirePointerPath), pointer.reportPath);
          let reportRaw = '';
          try {
            reportRaw = await readFile(resolvedReportPath, 'utf8');
          } catch {
            return {
              ok: false,
              message: `Live-fire report file is missing (${resolvedReportPath})`,
              hint: 'Re-run live-fire and ensure the report path in latest.json points to an existing JSON artifact.',
            };
          }
          try {
            reportValue = JSON.parse(reportRaw);
          } catch {
            return {
              ok: false,
              message: 'Live-fire reportPath does not contain valid JSON',
              hint: 'Re-run live-fire to regenerate a valid run report.',
            };
          }
        }

        const report = reportValue as {
          schema?: string;
          gates?: { passed?: boolean };
          aggregate?: { passRate?: number; totalRuns?: number };
          options?: {
            llmModes?: string[];
            protocol?: string;
            strictObjective?: boolean;
            includeSmoke?: boolean;
            reposRoot?: string;
          };
          runs?: Array<{ llmMode?: string; journey?: { total?: number }; smoke?: { total?: number } }>;
        };
        if (report?.schema !== 'LiveFireTrialReport.v1') {
          return {
            ok: false,
            message: `Live-fire artifact schema is invalid (${report?.schema ?? 'missing'})`,
            hint: 'Publish gating requires a full `LiveFireTrialReport.v1` artifact, not pointer-only metadata.',
          };
        }
        const reposRoot = report?.options?.reposRoot;
        if (typeof reposRoot !== 'string' || normalizeAbsolutePath(reposRoot) !== normalizeAbsolutePath(expectedReposRoot)) {
          return {
            ok: false,
            message: `Live-fire reposRoot is not the real external corpus (${reposRoot ?? 'missing'})`,
            hint: `Run live-fire against ${expectedReposRoot}.`,
          };
        }
        if (report?.options?.protocol !== 'objective' || report?.options?.strictObjective !== true || report?.options?.includeSmoke !== true) {
          return {
            ok: false,
            message: 'Live-fire run is not strict objective + smoke mode',
            hint: 'Release evidence requires objective protocol with strictObjective=true and includeSmoke=true.',
          };
        }
        const runCount = report?.aggregate?.totalRuns ?? report?.runs?.length ?? 0;
        if (runCount < RELEASE_MIN_LIVE_FIRE_RUNS) {
          return {
            ok: false,
            message: `Live-fire run count is too small (${runCount} < ${RELEASE_MIN_LIVE_FIRE_RUNS})`,
            hint: 'Increase rounds/modes so release evidence includes multiple independent live-fire runs.',
          };
        }
        const gatesPassed = report?.gates?.passed === true;
        const passRate = report?.aggregate?.passRate;
        if (!gatesPassed) {
          return {
            ok: false,
            message: 'Live-fire quick gate failed',
            hint: 'Run `npm run eval:live-fire:quick` and confirm gates.passed=true.',
          };
        }
        if (typeof passRate === 'number' && passRate < 1) {
          return {
            ok: false,
            message: `Live-fire quick passRate below 1.0 (${passRate.toFixed(3)})`,
            hint: 'Fix journey/smoke failures and rerun live-fire quick profile.',
          };
        }
        if (!Array.isArray(report?.runs) || report.runs.length === 0) {
          return {
            ok: false,
            message: 'Live-fire report is missing per-run evidence',
            hint: 'Re-run live-fire and ensure runs[] is populated.',
          };
        }
        if (report.runs.some((run) => (run.journey?.total ?? 0) <= 0)) {
          return {
            ok: false,
            message: 'Live-fire report contains runs without journey execution evidence',
            hint: 'Each run must include journey totals greater than zero.',
          };
        }
        if (report.runs.some((run) => (run.smoke?.total ?? 0) <= 0)) {
          return {
            ok: false,
            message: 'Live-fire report contains runs without smoke execution evidence',
            hint: 'Each run must include smoke totals greater than zero.',
          };
        }
        const configuredModes = Array.isArray(report?.options?.llmModes)
          ? report.options!.llmModes!.filter((mode): mode is string => typeof mode === 'string')
          : [];
        const observedModes = Array.isArray(report?.runs)
          ? Array.from(new Set(report.runs!.map((run) => run?.llmMode).filter((mode): mode is string => typeof mode === 'string')))
          : [];
        const llmModes = configuredModes.length > 0 ? configuredModes : observedModes;
        if (llmModes.length === 0 || !llmModes.includes('optional')) {
          return {
            ok: false,
            message: 'Live-fire report lacks optional LLM runs',
            hint: 'Run live-fire with llmModes including "optional"; disabled-only runs are non-release evidence.',
          };
        }
        const strictMarkers = detectStrictMarkers(reportValue);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `Live-fire report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Resolve degraded/fallback behavior before publish.',
          };
        }
        const imperfectionSignals = collectImperfectionSignals(reportValue);
        if (imperfectionSignals.length > 0) {
          return {
            ok: false,
            message: `Live-fire report records fallback/retry/degraded signals: ${imperfectionSignals.join(', ')}`,
            hint: 'Release evidence requires zero retry/fallback/degraded counters or flags.',
          };
        }
        return { ok: true, message: 'Live-fire quick gate passed' };
      },
    }),
    evaluateJsonSignal({
      id: 'release.ab_agentic_bugfix',
      filePath: abReportPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: (value) => {
        const report = value as {
          options?: {
            reposRoot?: string;
            workerTypes?: string[];
            evidenceProfile?: string;
          };
          gates?: {
            passed?: boolean;
            thresholds?: {
              requireAgentCommandTasks?: boolean;
              minAgentCommandShare?: number;
              minT3SuccessRateLift?: number;
              requireT3Significance?: boolean;
              minAgentVerifiedExecutionShare?: number;
              requireBaselineFailureForAgentTasks?: boolean;
              minArtifactIntegrityShare?: number;
              maxVerificationFallbackShare?: number;
              requireT3CeilingTimeReduction?: boolean;
            };
          };
          t3PlusLift?: {
            successRateLift?: number;
            absoluteSuccessRateDelta?: number;
            controlSuccessRate?: number;
            treatmentSuccessRate?: number;
            timeReduction?: number;
            agentCommandTimeReduction?: number;
            significance?: {
              statisticallySignificant?: boolean | null;
              sampleSizeAdequate?: boolean;
              inconclusiveReason?: string;
            };
          };
          diagnostics?: {
            verificationFallbackRuns?: number;
            verificationFallbackShare?: number;
            modeCounts?: {
              deterministic_edit?: number;
              agent_command?: number;
            };
          };
          results?: Array<{
            workerType?: string;
            mode?: string;
            failureReason?: string | null;
            extraContextFiles?: string[];
            artifactIntegrity?: { complete?: boolean };
            artifacts?: { directory?: string };
            agentCommand?: { command?: string };
          }>;
        };
        const reposRoot = report?.options?.reposRoot;
        if (typeof reposRoot !== 'string' || normalizeAbsolutePath(reposRoot) !== normalizeAbsolutePath(expectedReposRoot)) {
          return {
            ok: false,
            message: `A/B reposRoot is not the real external corpus (${reposRoot ?? 'missing'})`,
            hint: `Run A/B against ${expectedReposRoot}.`,
          };
        }
        const workerTypes = Array.isArray(report?.options?.workerTypes) ? report.options!.workerTypes! : [];
        if (!(workerTypes.includes('control') && workerTypes.includes('treatment'))) {
          return {
            ok: false,
            message: 'A/B report is missing control+treatment worker groups',
            hint: 'Run A/B with `--workers control,treatment`.',
          };
        }
        if ((report?.options?.evidenceProfile ?? 'custom') !== 'release') {
          return {
            ok: false,
            message: `A/B evidence profile is not release (${report?.options?.evidenceProfile ?? 'missing'})`,
            hint: 'Run strict A/B with `--evidenceProfile release` and publish that artifact.',
          };
        }
        const results = Array.isArray(report?.results) ? report.results : [];
        if (results.length === 0) {
          return {
            ok: false,
            message: 'A/B report does not contain run-level task results',
            hint: 'Release evidence requires per-task run artifacts, not summary-only payloads.',
          };
        }
        const nonAgentModes = results.filter((entry) => entry.mode !== 'agent_command').length;
        if (nonAgentModes > 0) {
          return {
            ok: false,
            message: `A/B report includes non-agent execution modes (${nonAgentModes} run(s))`,
            hint: 'Release evidence must use agent_command mode for all runs.',
          };
        }
        if (results.some((entry) => Boolean(entry.failureReason))) {
          return {
            ok: false,
            message: 'A/B report contains failed run entries',
            hint: 'Resolve all run-level failures before publish.',
          };
        }
        if (results.some((entry) => entry.artifactIntegrity?.complete !== true || !entry.artifacts?.directory)) {
          return {
            ok: false,
            message: 'A/B report contains incomplete artifact evidence',
            hint: 'Each run must persist complete artifacts with integrity confirmation.',
          };
        }
        const treatmentWithoutContext = results.filter((entry) =>
          entry.workerType === 'treatment' && (!Array.isArray(entry.extraContextFiles) || entry.extraContextFiles.length === 0)
        ).length;
        if (treatmentWithoutContext > 0) {
          return {
            ok: false,
            message: `A/B treatment runs missing Librarian context evidence (${treatmentWithoutContext})`,
            hint: 'Treatment runs must include retrieved Librarian context files.',
          };
        }
        const disallowedAgentCommands = results.filter((entry) => {
          const command = entry.agentCommand?.command ?? '';
          return typeof command === 'string' && command.includes('ab-agent-reference');
        }).length;
        if (disallowedAgentCommands > 0) {
          return {
            ok: false,
            message: `A/B report used reference agent command (${disallowedAgentCommands} run(s))`,
            hint: 'Reference agents are diagnostic-only and cannot be used as release evidence.',
          };
        }
        const modeCounts = report?.diagnostics?.modeCounts;
        if ((modeCounts?.deterministic_edit ?? 0) > 0 || (modeCounts?.agent_command ?? 0) <= 0) {
          return {
            ok: false,
            message: 'A/B diagnostics indicate deterministic or missing agent-command execution',
            hint: 'Release evidence requires 100% agent-command execution with no deterministic fallback.',
          };
        }
        const gatesPassed = report?.gates?.passed === true;
        if (!gatesPassed) {
          return {
            ok: false,
            message: 'A/B harness gate failed',
            hint: 'Run a strict agentic bugfix A/B run and publish that report (reference-mode reports are not release evidence).',
          };
        }
        const configuredThreshold = report?.gates?.thresholds?.minT3SuccessRateLift;
        if (typeof configuredThreshold !== 'number' || configuredThreshold < RELEASE_MIN_T3_LIFT) {
          return {
            ok: false,
            message: `A/B harness threshold too weak (minT3SuccessRateLift=${configuredThreshold ?? 'missing'})`,
            hint: `Run A/B with minT3SuccessRateLift >= ${RELEASE_MIN_T3_LIFT.toFixed(2)} and publish that report.`,
          };
        }
        const configuredAgentCommandShare = report?.gates?.thresholds?.minAgentCommandShare;
        if (typeof configuredAgentCommandShare !== 'number' || configuredAgentCommandShare < RELEASE_MIN_AB_AGENT_COMMAND_SHARE) {
          return {
            ok: false,
            message: `A/B harness agent command-share threshold too weak (minAgentCommandShare=${configuredAgentCommandShare ?? 'missing'})`,
            hint: `Run A/B with minAgentCommandShare >= ${RELEASE_MIN_AB_AGENT_COMMAND_SHARE.toFixed(2)} for release evidence.`,
          };
        }
        const configuredAgentVerifiedExecutionShare = report?.gates?.thresholds?.minAgentVerifiedExecutionShare;
        if (
          typeof configuredAgentVerifiedExecutionShare !== 'number'
          || configuredAgentVerifiedExecutionShare < RELEASE_MIN_AB_AGENT_VERIFIED_EXECUTION_SHARE
        ) {
          return {
            ok: false,
            message: `A/B harness verified-execution threshold too weak (minAgentVerifiedExecutionShare=${configuredAgentVerifiedExecutionShare ?? 'missing'})`,
            hint: `Run A/B with minAgentVerifiedExecutionShare >= ${RELEASE_MIN_AB_AGENT_VERIFIED_EXECUTION_SHARE.toFixed(2)}.`,
          };
        }
        const configuredArtifactIntegrityShare = report?.gates?.thresholds?.minArtifactIntegrityShare;
        if (
          typeof configuredArtifactIntegrityShare !== 'number'
          || configuredArtifactIntegrityShare < RELEASE_MIN_AB_ARTIFACT_INTEGRITY_SHARE
        ) {
          return {
            ok: false,
            message: `A/B harness artifact-integrity threshold too weak (minArtifactIntegrityShare=${configuredArtifactIntegrityShare ?? 'missing'})`,
            hint: `Run A/B with minArtifactIntegrityShare >= ${RELEASE_MIN_AB_ARTIFACT_INTEGRITY_SHARE.toFixed(2)}.`,
          };
        }
        if (report?.gates?.thresholds?.requireAgentCommandTasks !== true) {
          return {
            ok: false,
            message: 'A/B harness did not enforce requireAgentCommandTasks=true',
            hint: 'Run strict A/B with requireAgentCommandTasks enabled.',
          };
        }
        if (report?.gates?.thresholds?.requireBaselineFailureForAgentTasks !== true) {
          return {
            ok: false,
            message: 'A/B harness did not enforce baseline-failure guard for agent tasks',
            hint: 'Run strict A/B with requireBaselineFailureForAgentTasks=true.',
          };
        }
        if (report?.gates?.thresholds?.requireT3Significance !== true) {
          return {
            ok: false,
            message: 'A/B harness did not require T3+ significance',
            hint: 'Run strict A/B with requireT3Significance=true.',
          };
        }
        const configuredFallbackShare = report?.gates?.thresholds?.maxVerificationFallbackShare;
        if (typeof configuredFallbackShare !== 'number' || configuredFallbackShare > RELEASE_MAX_AB_VERIFICATION_FALLBACK_SHARE) {
          return {
            ok: false,
            message: `A/B harness fallback threshold is too permissive (maxVerificationFallbackShare=${configuredFallbackShare ?? 'missing'})`,
            hint: 'Run A/B with maxVerificationFallbackShare=0 to enforce no verification fallback in release evidence.',
          };
        }
        const fallbackRuns = report?.diagnostics?.verificationFallbackRuns ?? 0;
        const fallbackShare = report?.diagnostics?.verificationFallbackShare ?? 0;
        if (fallbackRuns > 0 || fallbackShare > 0) {
          return {
            ok: false,
            message: `A/B harness used verification fallback (${fallbackRuns} run(s), share=${fallbackShare.toFixed(3)})`,
            hint: 'Release evidence must pass without verification fallback paths.',
          };
        }
        const t3Lift = report?.t3PlusLift?.successRateLift;
        const t3ControlSuccessRate = report?.t3PlusLift?.controlSuccessRate;
        const t3TreatmentSuccessRate = report?.t3PlusLift?.treatmentSuccessRate;
        const t3AbsoluteDelta = report?.t3PlusLift?.absoluteSuccessRateDelta;
        const t3TimeReduction = report?.t3PlusLift?.timeReduction;
        const t3AgentTimeReduction = report?.t3PlusLift?.agentCommandTimeReduction;
        const requireT3CeilingTimeReduction = true;
        const successCeilingReached =
          typeof t3ControlSuccessRate === 'number'
          && typeof t3TreatmentSuccessRate === 'number'
          && typeof t3AbsoluteDelta === 'number'
          && t3ControlSuccessRate >= 0.999
          && t3TreatmentSuccessRate >= 0.999
          && Math.abs(t3AbsoluteDelta) < 1e-9;

        if (successCeilingReached) {
          if (requireT3CeilingTimeReduction) {
            const effectiveTimeReduction = Math.max(
              typeof t3TimeReduction === 'number' ? t3TimeReduction : Number.NEGATIVE_INFINITY,
              typeof t3AgentTimeReduction === 'number' ? t3AgentTimeReduction : Number.NEGATIVE_INFINITY,
            );
            if (!Number.isFinite(effectiveTimeReduction) || effectiveTimeReduction < RELEASE_MIN_T3_TIME_REDUCTION) {
              return {
                ok: false,
                message: `A/B harness ceiling-mode efficiency gain below threshold (effective=${Number.isFinite(effectiveTimeReduction) ? effectiveTimeReduction.toFixed(3) : 'missing'}, total=${t3TimeReduction ?? 'missing'}, agent=${t3AgentTimeReduction ?? 'missing'}; required >= ${RELEASE_MIN_T3_TIME_REDUCTION.toFixed(2)})`,
                hint: 'When T3+ success is saturated, treatment must still show clear time/efficiency gains.',
              };
            }
          }
        } else if (typeof t3Lift !== 'number' || t3Lift < RELEASE_MIN_T3_LIFT) {
          return {
            ok: false,
            message: `A/B harness T3+ lift below worldclass threshold (${t3Lift ?? 'missing'} < ${RELEASE_MIN_T3_LIFT.toFixed(2)})`,
            hint: 'Treatment must materially outperform control on T3+ tasks before publish.',
          };
        }
        const significance = report?.t3PlusLift?.significance;
        if (!significance || significance.sampleSizeAdequate !== true) {
          return {
            ok: false,
            message: 'A/B harness significance is not sample-adequate for T3+ lift',
            hint: 'Increase task/repo coverage until statistical adequacy is met.',
          };
        }
        if (!successCeilingReached && (significance.statisticallySignificant !== true || significance.inconclusiveReason)) {
          return {
            ok: false,
            message: `A/B harness T3+ lift is not statistically significant (${significance.inconclusiveReason ?? 'p-value not significant'})`,
            hint: 'Re-run with stronger treatment gains and enough samples to reach significance.',
          };
        }
        const strictMarkers = detectStrictMarkers(value);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `A/B harness report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Fix fallback/degraded behavior and re-run A/B harness.',
          };
        }
        const rawImperfectionSignals = collectImperfectionSignals(value);
        const imperfectionSignals = successCeilingReached
          ? rawImperfectionSignals.filter((signal) =>
            !signal.startsWith('t3PlusLift.significance.inconclusiveReason=')
            && !signal.startsWith('lift.significance.inconclusiveReason=')
          )
          : rawImperfectionSignals;
        if (imperfectionSignals.length > 0) {
          return {
            ok: false,
            message: `A/B harness report records fallback/retry/degraded signals: ${imperfectionSignals.join(', ')}`,
            hint: 'Release evidence requires zero retry/fallback/degraded counters or flags.',
          };
        }
        return { ok: true, message: 'A/B harness gate passed' };
      },
    }),
    evaluateJsonSignal({
      id: 'release.agentic_use_case_review',
      filePath: useCaseReportPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: (value) => {
        const report = value as {
          schema?: string;
          options?: {
            reposRoot?: string;
            selectionMode?: string;
            deterministicQueries?: boolean;
            evidenceProfile?: string;
          };
          summary?: {
            passRate?: number;
            evidenceRate?: number;
            usefulSummaryRate?: number;
            strictFailureShare?: number;
            uniqueRepos?: number;
            progression?: {
              enabled?: boolean;
              prerequisitePassRate?: number;
              targetPassRate?: number;
              targetDependencyReadyShare?: number;
            };
          };
          gate?: {
            passed?: boolean;
            thresholds?: {
              minPassRate?: number;
              minEvidenceRate?: number;
              minUsefulSummaryRate?: number;
              maxStrictFailureShare?: number;
              minPrerequisitePassRate?: number;
              minTargetPassRate?: number;
              minTargetDependencyReadyShare?: number;
            };
          };
        };
        if (report?.schema !== 'AgenticUseCaseReviewReport.v1') {
          return {
            ok: false,
            message: `Use-case review artifact schema is invalid (${report?.schema ?? 'missing'})`,
            hint: 'Run `npm run eval:use-cases:agentic` to generate `AgenticUseCaseReviewReport.v1`.',
          };
        }
        const reposRoot = report?.options?.reposRoot;
        if (typeof reposRoot !== 'string' || normalizeAbsolutePath(reposRoot) !== normalizeAbsolutePath(expectedReposRoot)) {
          return {
            ok: false,
            message: `Use-case review reposRoot is not the real external corpus (${reposRoot ?? 'missing'})`,
            hint: `Run use-case review against ${expectedReposRoot}.`,
          };
        }
        if ((report?.options?.evidenceProfile ?? 'custom') !== 'release') {
          return {
            ok: false,
            message: `Use-case evidence profile is not release (${report?.options?.evidenceProfile ?? 'missing'})`,
            hint: 'Run use-case review with `--evidenceProfile release` for publish evidence.',
          };
        }
        const selectionMode = report?.options?.selectionMode;
        if (typeof selectionMode !== 'string' || !RELEASE_ALLOWED_USE_CASE_SELECTION_MODES.has(selectionMode)) {
          return {
            ok: false,
            message: `Use-case selection mode is not release-approved (${selectionMode ?? 'missing'})`,
            hint: 'Release evidence requires `--selectionMode balanced` or `--selectionMode probabilistic`.',
          };
        }
        if (report?.options?.deterministicQueries === true) {
          return {
            ok: false,
            message: 'Use-case review was run with deterministicQueries enabled',
            hint: 'Release evidence requires live, non-deterministic agentic behavior.',
          };
        }
        if (report?.gate?.passed !== true) {
          return {
            ok: false,
            message: 'Use-case review gate failed',
            hint: 'Fix use-case failures and rerun strict use-case evaluation.',
          };
        }
        const thresholds = report?.gate?.thresholds;
        if (!thresholds) {
          return {
            ok: false,
            message: 'Use-case review thresholds are missing',
            hint: 'Persist gate thresholds in the use-case report for publish validation.',
          };
        }
        if ((thresholds.minPassRate ?? 0) < RELEASE_MIN_USE_CASE_PASS_RATE) {
          return {
            ok: false,
            message: `Use-case pass threshold too weak (minPassRate=${thresholds.minPassRate ?? 'missing'})`,
            hint: `Use minPassRate >= ${RELEASE_MIN_USE_CASE_PASS_RATE.toFixed(2)} for release evidence.`,
          };
        }
        if ((thresholds.minEvidenceRate ?? 0) < RELEASE_MIN_USE_CASE_EVIDENCE_RATE) {
          return {
            ok: false,
            message: `Use-case evidence threshold too weak (minEvidenceRate=${thresholds.minEvidenceRate ?? 'missing'})`,
            hint: `Use minEvidenceRate >= ${RELEASE_MIN_USE_CASE_EVIDENCE_RATE.toFixed(2)} for release evidence.`,
          };
        }
        if ((thresholds.minUsefulSummaryRate ?? 0) < RELEASE_MIN_USE_CASE_USEFUL_SUMMARY_RATE) {
          return {
            ok: false,
            message: `Use-case summary threshold too weak (minUsefulSummaryRate=${thresholds.minUsefulSummaryRate ?? 'missing'})`,
            hint: `Use minUsefulSummaryRate >= ${RELEASE_MIN_USE_CASE_USEFUL_SUMMARY_RATE.toFixed(2)} for release evidence.`,
          };
        }
        if ((thresholds.maxStrictFailureShare ?? 1) > RELEASE_MAX_USE_CASE_STRICT_FAILURE_SHARE) {
          return {
            ok: false,
            message: `Use-case strict-failure threshold is too permissive (maxStrictFailureShare=${thresholds.maxStrictFailureShare ?? 'missing'})`,
            hint: 'Release evidence requires maxStrictFailureShare=0.',
          };
        }
        if ((thresholds.minPrerequisitePassRate ?? 0) < RELEASE_MIN_USE_CASE_PREREQUISITE_PASS_RATE) {
          return {
            ok: false,
            message: `Use-case prerequisite threshold too weak (minPrerequisitePassRate=${thresholds.minPrerequisitePassRate ?? 'missing'})`,
            hint: `Use minPrerequisitePassRate >= ${RELEASE_MIN_USE_CASE_PREREQUISITE_PASS_RATE.toFixed(2)}.`,
          };
        }
        if ((thresholds.minTargetPassRate ?? 0) < RELEASE_MIN_USE_CASE_TARGET_PASS_RATE) {
          return {
            ok: false,
            message: `Use-case target threshold too weak (minTargetPassRate=${thresholds.minTargetPassRate ?? 'missing'})`,
            hint: `Use minTargetPassRate >= ${RELEASE_MIN_USE_CASE_TARGET_PASS_RATE.toFixed(2)}.`,
          };
        }
        if ((thresholds.minTargetDependencyReadyShare ?? 0) < RELEASE_MIN_USE_CASE_TARGET_DEPENDENCY_READY_SHARE) {
          return {
            ok: false,
            message: `Use-case dependency-ready threshold too weak (minTargetDependencyReadyShare=${thresholds.minTargetDependencyReadyShare ?? 'missing'})`,
            hint: `Use minTargetDependencyReadyShare >= ${RELEASE_MIN_USE_CASE_TARGET_DEPENDENCY_READY_SHARE.toFixed(2)}.`,
          };
        }
        const summary = report?.summary;
        if (!summary) {
          return {
            ok: false,
            message: 'Use-case review summary is missing',
            hint: 'Re-run use-case review to persist summary metrics.',
          };
        }
        if ((summary.uniqueRepos ?? 0) < RELEASE_MIN_USE_CASE_REPOS) {
          return {
            ok: false,
            message: `Use-case review repo coverage is too small (${summary.uniqueRepos ?? 0} < ${RELEASE_MIN_USE_CASE_REPOS})`,
            hint: 'Increase maxRepos for release use-case evaluation to broaden coverage.',
          };
        }
        if ((summary.passRate ?? 0) < RELEASE_MIN_USE_CASE_PASS_RATE) {
          return {
            ok: false,
            message: `Use-case pass rate below threshold (${summary.passRate ?? 'missing'} < ${RELEASE_MIN_USE_CASE_PASS_RATE.toFixed(2)})`,
            hint: 'Fix failing use-cases before publish.',
          };
        }
        if ((summary.evidenceRate ?? 0) < RELEASE_MIN_USE_CASE_EVIDENCE_RATE) {
          return {
            ok: false,
            message: `Use-case evidence rate below threshold (${summary.evidenceRate ?? 'missing'} < ${RELEASE_MIN_USE_CASE_EVIDENCE_RATE.toFixed(2)})`,
            hint: 'Improve evidence grounding in use-case outputs before publish.',
          };
        }
        if ((summary.usefulSummaryRate ?? 0) < RELEASE_MIN_USE_CASE_USEFUL_SUMMARY_RATE) {
          return {
            ok: false,
            message: `Use-case useful-summary rate below threshold (${summary.usefulSummaryRate ?? 'missing'} < ${RELEASE_MIN_USE_CASE_USEFUL_SUMMARY_RATE.toFixed(2)})`,
            hint: 'Improve summary quality before publish.',
          };
        }
        if ((summary.strictFailureShare ?? 1) > RELEASE_MAX_USE_CASE_STRICT_FAILURE_SHARE) {
          return {
            ok: false,
            message: `Use-case strict failure share is non-zero (${summary.strictFailureShare ?? 'missing'})`,
            hint: 'Release evidence requires zero strict failures in use-case review.',
          };
        }
        const progression = summary.progression;
        if (!progression) {
          return {
            ok: false,
            message: 'Use-case progression summary is missing',
            hint: 'Re-run use-case review with progressive prerequisites enabled.',
          };
        }
        if (progression.enabled === true) {
          if ((progression.prerequisitePassRate ?? 0) < RELEASE_MIN_USE_CASE_PREREQUISITE_PASS_RATE) {
            return {
              ok: false,
              message: `Use-case prerequisite pass rate below threshold (${progression.prerequisitePassRate ?? 'missing'} < ${RELEASE_MIN_USE_CASE_PREREQUISITE_PASS_RATE.toFixed(2)})`,
              hint: 'Improve prerequisite use-case performance before publish.',
            };
          }
          if ((progression.targetPassRate ?? 0) < RELEASE_MIN_USE_CASE_TARGET_PASS_RATE) {
            return {
              ok: false,
              message: `Use-case target pass rate below threshold (${progression.targetPassRate ?? 'missing'} < ${RELEASE_MIN_USE_CASE_TARGET_PASS_RATE.toFixed(2)})`,
              hint: 'Improve target use-case performance before publish.',
            };
          }
          if ((progression.targetDependencyReadyShare ?? 0) < RELEASE_MIN_USE_CASE_TARGET_DEPENDENCY_READY_SHARE) {
            return {
              ok: false,
              message: `Use-case dependency-ready share below threshold (${progression.targetDependencyReadyShare ?? 'missing'} < ${RELEASE_MIN_USE_CASE_TARGET_DEPENDENCY_READY_SHARE.toFixed(2)})`,
              hint: 'Ensure target use-cases only run once prerequisites are fully ready.',
            };
          }
        }
        const strictMarkers = detectStrictMarkers(report);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `Use-case report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Resolve fallback/degraded behavior and regenerate use-case evidence.',
          };
        }
        const imperfectionSignals = collectImperfectionSignals(report);
        if (imperfectionSignals.length > 0) {
          return {
            ok: false,
            message: `Use-case report records fallback/retry/degraded signals: ${imperfectionSignals.join(', ')}`,
            hint: 'Release evidence requires zero retry/fallback/degraded counters or flags.',
          };
        }
        return { ok: true, message: 'Agentic use-case review gate passed' };
      },
    }),
    evaluateJsonSignal({
      id: 'release.external_smoke_sample',
      filePath: externalSmokeReportPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: async (value) => {
        const report = value as {
          schema?: string;
          options?: { reposRoot?: string };
          summary?: { failures?: number; total?: number };
          results?: Array<{ repo?: string; errors?: unknown[]; overviewOk?: boolean; contextOk?: boolean }>;
        };
        if (report?.schema !== 'ExternalRepoSmokeRunArtifact.v1') {
          return {
            ok: false,
            message: `External smoke artifact schema is invalid (${report?.schema ?? 'missing'})`,
            hint: 'Release evidence requires `ExternalRepoSmokeRunArtifact.v1` from `smoke:external:all`.',
          };
        }
        const reposRoot = report?.options?.reposRoot;
        if (typeof reposRoot !== 'string' || normalizeAbsolutePath(reposRoot) !== normalizeAbsolutePath(expectedReposRoot)) {
          return {
            ok: false,
            message: `External smoke reposRoot is not the real external corpus (${reposRoot ?? 'missing'})`,
            hint: `Run external smoke against ${expectedReposRoot}.`,
          };
        }
        const failures = report?.summary?.failures;
        if (typeof failures !== 'number') {
          return {
            ok: false,
            message: 'External smoke report missing summary.failures',
            hint: 'Re-run smoke sample to regenerate a valid report.',
          };
        }
        if (failures > 0) {
          return {
            ok: false,
            message: `External smoke sample has ${failures} failure(s)`,
            hint: 'Run `npm run smoke:external:sample` and resolve failures.',
          };
        }
        const total = report?.summary?.total ?? 0;
        if (!Number.isFinite(total) || total < RELEASE_MIN_EXTERNAL_SMOKE_REPOS) {
          return {
            ok: false,
            message: `External smoke repo count is too small (${total} < ${RELEASE_MIN_EXTERNAL_SMOKE_REPOS})`,
            hint: 'Release evidence must cover multiple external repos, not single-repo smoke checks.',
          };
        }
        const results = Array.isArray(report?.results)
          ? report.results
          : [];
        if (results.length < RELEASE_MIN_EXTERNAL_SMOKE_REPOS) {
          return {
            ok: false,
            message: `External smoke result entries are too few (${results.length} < ${RELEASE_MIN_EXTERNAL_SMOKE_REPOS})`,
            hint: 'Persist all-repo smoke results and use that artifact for publish gate.',
          };
        }
        if (results.some((result) => Array.isArray(result.errors) && result.errors.length > 0)) {
          return {
            ok: false,
            message: 'External smoke sample includes repo errors',
            hint: 'Resolve repo-level smoke errors before publish.',
          };
        }
        if (results.some((result) => !result.overviewOk && !result.contextOk)) {
          return {
            ok: false,
            message: 'External smoke sample contains unusable context responses',
            hint: 'Fix retrieval/context generation so each smoke repo has useful output.',
          };
        }
        const manifestPath = path.join(expectedReposRoot, 'manifest.json');
        let manifest: { repos?: Array<{ name?: string; language?: string }> } | null = null;
        try {
          manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { repos?: Array<{ name?: string; language?: string }> };
        } catch {
          manifest = null;
        }
        if (!manifest || !Array.isArray(manifest.repos) || manifest.repos.length === 0) {
          return {
            ok: false,
            message: 'External repos manifest is missing language metadata',
            hint: 'Populate eval-corpus/external-repos/manifest.json with repo language fields before publish.',
          };
        }
        const languageByRepo = new Map<string, string>();
        const manifestLanguages = new Set<string>();
        for (const repo of manifest.repos) {
          if (typeof repo?.name !== 'string' || repo.name.trim().length === 0) continue;
          if (typeof repo?.language !== 'string' || repo.language.trim().length === 0) continue;
          const language = repo.language.trim().toLowerCase();
          languageByRepo.set(repo.name, language);
          manifestLanguages.add(language);
        }
        const coveredLanguages = new Set<string>();
        for (const result of results) {
          if (typeof result.repo !== 'string' || result.repo.trim().length === 0) continue;
          const language = languageByRepo.get(result.repo);
          if (language) coveredLanguages.add(language);
        }
        const requiredLanguageCoverage = Math.max(
          RELEASE_MIN_EXTERNAL_SMOKE_LANGUAGES,
          Math.min(RELEASE_TARGET_EXTERNAL_SMOKE_LANGUAGES, manifestLanguages.size)
        );
        if (coveredLanguages.size < requiredLanguageCoverage) {
          return {
            ok: false,
            message: `External smoke language coverage is too narrow (${coveredLanguages.size} < ${requiredLanguageCoverage})`,
            hint: `Run smoke over a language-diverse repo set; release evidence must cover up to ${RELEASE_TARGET_EXTERNAL_SMOKE_LANGUAGES} manifest languages.`,
          };
        }
        const strictMarkers = detectStrictMarkers(report);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `External smoke report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Resolve fallback/degraded smoke behavior before publish.',
          };
        }
        const imperfectionSignals = collectImperfectionSignals(report);
        if (imperfectionSignals.length > 0) {
          return {
            ok: false,
            message: `External smoke report records fallback/retry/degraded signals: ${imperfectionSignals.join(', ')}`,
            hint: 'Release evidence requires zero retry/fallback/degraded counters or flags.',
          };
        }
        return { ok: true, message: 'External smoke sample passed' };
      },
    }),
    evaluateJsonSignal({
      id: 'release.testing_discipline',
      filePath: testingDisciplineReportPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: (value) => {
        const report = value as {
          schema?: string;
          passed?: boolean;
          summary?: {
            totalChecks?: number;
            passedChecks?: number;
            failedBlockingChecks?: number;
            warningChecks?: number;
          };
          checks?: Array<{ id?: string; passed?: boolean; severity?: 'blocking' | 'warning' }>;
        };
        if (report?.schema !== 'TestingDisciplineReport.v1') {
          return {
            ok: false,
            message: `Testing-discipline artifact schema is invalid (${report?.schema ?? 'missing'})`,
            hint: 'Run `npm run eval:testing-discipline` to generate `TestingDisciplineReport.v1`.',
          };
        }
        const totalChecks = report.summary?.totalChecks ?? 0;
        const passedChecks = report.summary?.passedChecks ?? 0;
        const blockingFailures = report.summary?.failedBlockingChecks ?? 0;
        const warningFailures = report.summary?.warningChecks ?? 0;
        if (!report.passed || blockingFailures > 0 || warningFailures > 0) {
          return {
            ok: false,
            message: `Testing discipline not clean (passed=${report.passed === true}, blocking=${blockingFailures}, warnings=${warningFailures})`,
            hint: 'Resolve all testing-discipline failures (blocking and warning) before publish.',
          };
        }
        if (totalChecks < 10 || passedChecks < 10) {
          return {
            ok: false,
            message: `Testing discipline coverage is incomplete (passed=${passedChecks}, total=${totalChecks})`,
            hint: 'Keep all ten testing-discipline checks enabled and passing.',
          };
        }
        const checks = Array.isArray(report.checks) ? report.checks : [];
        const expectedCheckIds = new Set([
          'td_01_ab_agent_mode_purity',
          'td_02_ab_baseline_to_fix_causality',
          'td_03_ab_treatment_context_localization',
          'td_04_ab_artifact_integrity_verification',
          'td_05_ab_no_fallback_no_strict_markers',
          'td_06_use_case_breadth_and_quality',
          'td_07_live_fire_objective_coverage',
          'td_08_external_smoke_cross_language',
          'td_09_composition_selection_quality',
          'td_10_constructable_auto_adaptation',
        ]);
        const missingIds = Array.from(expectedCheckIds).filter((checkId) => !checks.some((check) => check.id === checkId));
        if (missingIds.length > 0) {
          return {
            ok: false,
            message: `Testing discipline report is missing checks: ${missingIds.join(', ')}`,
            hint: 'Regenerate testing-discipline report with the canonical 10 checks.',
          };
        }
        const failingChecks = checks.filter((check) => check.passed !== true);
        if (failingChecks.length > 0) {
          return {
            ok: false,
            message: `Testing discipline has failing checks: ${failingChecks.map((check) => check.id ?? 'unknown').join(', ')}`,
            hint: 'All testing-discipline checks must pass for release.',
          };
        }
        const strictMarkers = detectStrictMarkers(report);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `Testing discipline report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Remove fallback/unverified signals from release evidence and rerun discipline evaluation.',
          };
        }
        return { ok: true, message: 'Testing discipline gate passed' };
      },
    }),
    evaluateJsonSignal({
      id: 'release.testing_tracker',
      filePath: testingTrackerReportPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: (value) => {
        const report = value as {
          schema?: string;
          summary?: {
            publishReady?: boolean;
            fixedCount?: number;
            openCount?: number;
            unknownCount?: number;
          };
          artifacts?: Array<{
            id?: string;
            present?: boolean;
            parseError?: string;
          }>;
          flaws?: Array<{ id?: string; status?: string }>;
        };
        if (report?.schema !== 'TestingTrackerReport.v1') {
          return {
            ok: false,
            message: `Testing-tracker artifact schema is invalid (${report?.schema ?? 'missing'})`,
            hint: 'Run `npm run eval:testing-tracker` to generate `TestingTrackerReport.v1`.',
          };
        }
        const summary = report.summary;
        if (!summary) {
          return {
            ok: false,
            message: 'Testing-tracker summary is missing',
            hint: 'Regenerate testing-tracker evidence before publish.',
          };
        }
        if (summary.publishReady !== true || (summary.openCount ?? 0) !== 0 || (summary.unknownCount ?? 0) !== 0) {
          return {
            ok: false,
            message: `Testing tracker not publish-ready (publishReady=${summary.publishReady === true}, open=${summary.openCount ?? 'missing'}, unknown=${summary.unknownCount ?? 'missing'})`,
            hint: 'Resolve all open/unknown tracker flaws before publish.',
          };
        }
        const artifacts = Array.isArray(report.artifacts) ? report.artifacts : [];
        const requiredArtifacts = ['ab', 'useCase', 'liveFire', 'smoke', 'testingDiscipline'];
        const missingArtifacts = requiredArtifacts.filter((artifactId) => !artifacts.some((artifact) => artifact.id === artifactId));
        if (missingArtifacts.length > 0) {
          return {
            ok: false,
            message: `Testing tracker missing required artifacts: ${missingArtifacts.join(', ')}`,
            hint: 'Run the full strict chain before refreshing testing-tracker evidence.',
          };
        }
        const notPresentArtifacts = artifacts
          .filter((artifact) => requiredArtifacts.includes(String(artifact.id)))
          .filter((artifact) => artifact.present !== true || Boolean(artifact.parseError));
        if (notPresentArtifacts.length > 0) {
          return {
            ok: false,
            message: `Testing tracker has missing/invalid artifacts: ${notPresentArtifacts.map((artifact) => String(artifact.id)).join(', ')}`,
            hint: 'Refresh all evaluation artifacts and regenerate testing-tracker report.',
          };
        }
        const flaws = Array.isArray(report.flaws) ? report.flaws : [];
        const unresolvedFlaws = flaws.filter((flaw) => flaw.status !== 'fixed');
        if (unresolvedFlaws.length > 0) {
          return {
            ok: false,
            message: `Testing tracker has unresolved flaws: ${unresolvedFlaws.map((flaw) => flaw.id ?? 'unknown').join(', ')}`,
            hint: 'Resolve tracker flaws and ensure only fixed statuses remain.',
          };
        }
        const strictMarkers = detectStrictMarkers(report);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `Testing tracker report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Remove fallback/unverified signals from strict release evidence.',
          };
        }
        return { ok: true, message: 'Testing tracker gate passed' };
      },
    }),
    evaluateJsonSignal({
      id: 'release.final_verification',
      filePath: finalVerificationReportPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: (value) => {
        const report = value as {
          validation_results?: {
            phase21?: {
              memoryPerKLOC?: number;
              samples?: unknown[];
              benchmarkPlan?: {
                requestedSamples?: number;
                selectedCandidates?: number;
                executedSamples?: number;
                skippedSamples?: number;
                skipped?: unknown[];
              };
            };
          };
          targets?: {
            phase21?: {
              memoryPerKLOC?: number;
            };
          };
          targets_met?: {
            phase21_memory?: boolean;
          };
        };

        const phase21 = report?.validation_results?.phase21;
        if (!phase21) {
          return {
            ok: false,
            message: 'Final verification report missing validation_results.phase21',
            hint: 'Run `npm run evidence:refresh` to regenerate final verification evidence.',
          };
        }
        const measuredMemoryPerKLOCRaw = phase21.memoryPerKLOC;
        if (typeof measuredMemoryPerKLOCRaw !== 'number' || !Number.isFinite(measuredMemoryPerKLOCRaw)) {
          return {
            ok: false,
            message: 'Final verification report missing phase21.memoryPerKLOC',
            hint: 'Ensure phase21 benchmark output includes memoryPerKLOC.',
          };
        }
        const measuredMemoryPerKLOC = measuredMemoryPerKLOCRaw;
        const targetMemoryPerKLOCRaw = report?.targets?.phase21?.memoryPerKLOC;
        if (typeof targetMemoryPerKLOCRaw !== 'number' || !Number.isFinite(targetMemoryPerKLOCRaw)) {
          return {
            ok: false,
            message: 'Final verification report missing targets.phase21.memoryPerKLOC',
            hint: 'Persist phase21 memory target in final verification report.',
          };
        }
        const targetMemoryPerKLOC = targetMemoryPerKLOCRaw;
        const targetMet = report?.targets_met?.phase21_memory;
        if (targetMet !== true || measuredMemoryPerKLOC > targetMemoryPerKLOC) {
          return {
            ok: false,
            message: `Final verification phase21 memory target not met (measured=${measuredMemoryPerKLOC}, target=${targetMemoryPerKLOC}, targetMet=${targetMet === true})`,
            hint: 'Reduce phase21 memory usage and rerun evidence refresh.',
          };
        }

        const samples = Array.isArray(phase21.samples) ? phase21.samples : [];
        if (samples.length < RELEASE_MIN_FINAL_VERIFICATION_SAMPLES) {
          return {
            ok: false,
            message: `Final verification sample coverage is too small (${samples.length} < ${RELEASE_MIN_FINAL_VERIFICATION_SAMPLES})`,
            hint: `Collect at least ${RELEASE_MIN_FINAL_VERIFICATION_SAMPLES} successful benchmark samples for release evidence.`,
          };
        }

        const benchmarkPlan = phase21.benchmarkPlan;
        if (!benchmarkPlan) {
          return {
            ok: false,
            message: 'Final verification benchmarkPlan is missing',
            hint: 'Regenerate final verification report with benchmarkPlan telemetry.',
          };
        }
        const requestedSamplesRaw = benchmarkPlan.requestedSamples;
        const selectedCandidatesRaw = benchmarkPlan.selectedCandidates;
        const executedSamplesRaw = benchmarkPlan.executedSamples;
        const skippedSamplesRaw = benchmarkPlan.skippedSamples;
        const skipped = Array.isArray(benchmarkPlan.skipped) ? benchmarkPlan.skipped : [];
        if (
          typeof requestedSamplesRaw !== 'number'
          || !Number.isFinite(requestedSamplesRaw)
          || typeof selectedCandidatesRaw !== 'number'
          || !Number.isFinite(selectedCandidatesRaw)
          || typeof executedSamplesRaw !== 'number'
          || !Number.isFinite(executedSamplesRaw)
          || typeof skippedSamplesRaw !== 'number'
          || !Number.isFinite(skippedSamplesRaw)
        ) {
          return {
            ok: false,
            message: 'Final verification benchmarkPlan counters are incomplete',
            hint: 'Persist requested/selected/executed/skipped counters in phase21.benchmarkPlan.',
          };
        }
        const requestedSamples = requestedSamplesRaw;
        const selectedCandidates = selectedCandidatesRaw;
        const executedSamples = executedSamplesRaw;
        const skippedSamples = skippedSamplesRaw;
        if (requestedSamples < RELEASE_MIN_FINAL_VERIFICATION_SAMPLES || selectedCandidates < RELEASE_MIN_FINAL_VERIFICATION_SAMPLES) {
          return {
            ok: false,
            message: `Final verification benchmark plan is too small (requested=${requestedSamples}, selected=${selectedCandidates})`,
            hint: `Use at least ${RELEASE_MIN_FINAL_VERIFICATION_SAMPLES} benchmark candidates for release evidence.`,
          };
        }
        if (executedSamples !== requestedSamples) {
          return {
            ok: false,
            message: `Final verification benchmark execution incomplete (executed=${executedSamples}, requested=${requestedSamples})`,
            hint: 'Resolve timeout/OOM/invalid benchmark candidates until all requested runs execute successfully.',
          };
        }
        if (skippedSamples !== 0 || skipped.length > 0) {
          return {
            ok: false,
            message: `Final verification benchmark skipped samples detected (skippedSamples=${skippedSamples}, skippedEntries=${skipped.length})`,
            hint: 'Release evidence requires zero skipped benchmark runs.',
          };
        }

        const strictMarkers = detectStrictMarkers(report);
        if (strictMarkers.length > 0) {
          return {
            ok: false,
            message: `Final verification report contains strict failure markers: ${strictMarkers.join(', ')}`,
            hint: 'Fix strict markers in final verification artifacts before publish.',
          };
        }
        return { ok: true, message: 'Final verification gate passed' };
      },
    }),
    evaluateMarkdownSignal({
      id: 'release.conversation_insights_review',
      filePath: conversationInsightsPath,
      maxArtifactAgeHours: input.maxArtifactAgeHours,
      evaluate: (markdown) => {
        const missingHeadings = findMissingMarkdownHeadings(markdown, REQUIRED_CONVERSATION_INSIGHTS_HEADINGS);
        if (missingHeadings.length > 0) {
          return {
            ok: false,
            message: `Conversation insights doc is missing required sections: ${missingHeadings.join(', ')}`,
            hint: 'Update docs/librarian/CONVERSATION_INSIGHTS.md to include all required sections.',
          };
        }
        const reviewChecked = new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*${escapeRegExp(CONVERSATION_INSIGHTS_REVIEW_TOKEN)}\\s*$`, 'm')
          .test(markdown);
        if (!reviewChecked) {
          return {
            ok: false,
            message: 'Conversation insights review checklist item is not checked',
            hint: `Mark \`- [x] ${CONVERSATION_INSIGHTS_REVIEW_TOKEN}\` before publish.`,
          };
        }
        const noFallbackChecked = new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*${escapeRegExp(CONVERSATION_NO_FALLBACK_TOKEN)}\\s*$`, 'm')
          .test(markdown);
        if (!noFallbackChecked) {
          return {
            ok: false,
            message: 'Conversation insights no-fallback checklist item is not checked',
            hint: `Mark \`- [x] ${CONVERSATION_NO_FALLBACK_TOKEN}\` before publish.`,
          };
        }
        return { ok: true, message: 'Conversation insights review gate passed' };
      },
    }),
  ]);
}

function parseNotMetMetrics(statusMarkdown: string): string[] {
  const metrics: string[] = [];
  const lines = statusMarkdown.split('\n');
  for (const line of lines) {
    if (!line.includes('|')) continue;
    if (!line.includes('NOT MET')) continue;
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 5) continue;
    const metricName = parts[1];
    if (!metricName || metricName.toLowerCase() === 'metric') continue;
    metrics.push(metricName);
  }
  return metrics;
}

function summarizeTaskStatuses(tasks: Record<string, { status?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of Object.values(tasks)) {
    const status = String(value?.status ?? '').trim();
    if (!status) continue;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export function evaluatePublishReadiness(input: {
  workspace: string;
  gatesFilePath: string;
  statusFilePath: string;
  gates: GatesFile;
  statusMarkdown: string;
  profile?: PublishGateProfile;
  releaseSignals?: PublishGateSignal[];
  maxArtifactAgeHours?: number;
  includeBacklogStatusWarning?: boolean;
}): PublishGateReport {
  const profile = input.profile ?? 'release';
  const blockers: PublishGateIssue[] = [];
  const warnings: PublishGateIssue[] = [];
  const broadIssues = collectBroadIssues({ gates: input.gates, statusMarkdown: input.statusMarkdown });
  const includeBacklogStatusWarning = input.includeBacklogStatusWarning ?? false;

  if (profile === 'broad') {
    blockers.push(...broadIssues.blockers);
    warnings.push(...broadIssues.warnings);
  } else {
    const broadIssueCount = broadIssues.blockers.length + broadIssues.warnings.length;
    if (includeBacklogStatusWarning && broadIssueCount > 0) {
      warnings.push({
        id: 'release.backlog_status_drift',
        scope: 'summary',
        status: 'status_drift',
        severity: 'warning',
        count: broadIssueCount,
        message: `${broadIssueCount} non-release status drift issue(s) detected in GATES/STATUS`,
        hint: 'Run `librarian publish-gate --profile broad` to inspect full backlog status drift.',
      });
    }

    const releaseSignals = input.releaseSignals ?? [];
    const signalById = new Map(releaseSignals.map((signal) => [signal.id, signal] as const));
    for (const requiredSignalId of RELEASE_REQUIRED_SIGNAL_IDS) {
      if (signalById.has(requiredSignalId)) continue;
      blockers.push({
        id: requiredSignalId,
        scope: 'files',
        status: 'missing',
        severity: 'blocking',
        message: `Missing required release signal: ${requiredSignalId}`,
        hint: 'Run the strict evaluation chain to generate every required release artifact.',
      });
    }

    for (const signal of releaseSignals) {
      if (signal.status === 'pass') continue;
      const issue: PublishGateIssue = {
        id: signal.id,
        scope: 'files',
        status: signal.status,
        severity: signal.status === 'fail' ? 'blocking' : 'warning',
        message: signal.message,
        hint: signal.hint,
      };
      if (issue.severity === 'blocking') blockers.push(issue);
      else warnings.push(issue);
    }

    const gatesStrictMarkers = detectStrictMarkers(input.gates);
    if (gatesStrictMarkers.length > 0) {
      blockers.push({
        id: 'release.gates_strict_markers',
        scope: 'files',
        status: 'strict_marker_detected',
        severity: 'blocking',
        count: gatesStrictMarkers.length,
        message: `GATES artifact contains strict failure markers: ${gatesStrictMarkers.join(', ')}`,
        hint: 'Release evidence must not carry fallback/unverified markers in docs/librarian/GATES.json.',
      });
    }

    const statusStrictMarkers = detectStrictMarkers(input.statusMarkdown);
    if (statusStrictMarkers.length > 0) {
      blockers.push({
        id: 'release.status_strict_markers',
        scope: 'files',
        status: 'strict_marker_detected',
        severity: 'blocking',
        count: statusStrictMarkers.length,
        message: `STATUS artifact contains strict failure markers: ${statusStrictMarkers.join(', ')}`,
        hint: 'Release evidence must not carry fallback/unverified markers in docs/librarian/STATUS.md.',
      });
    }

    const notMetMetrics = parseNotMetMetrics(input.statusMarkdown);
    for (const metric of notMetMetrics) {
      const blockingMetric = RELEASE_BLOCKING_METRICS.has(normalizeMetricName(metric));
      const issue: PublishGateIssue = {
        id: `metrics.${metric.replace(/\s+/g, '_').toLowerCase()}`,
        scope: 'metrics',
        status: 'NOT MET',
        severity: blockingMetric ? 'blocking' : 'warning',
        message: `Metric target not met: ${metric}`,
        hint: blockingMetric
          ? 'Close this release-critical metric gap before publish.'
          : 'Track and improve this metric before broad release rollout.',
      };
      if (blockingMetric) blockers.push(issue);
      else warnings.push(issue);
    }
  }

  return {
    schema: 'PublishReadinessReport.v1',
    createdAt: new Date().toISOString(),
    workspace: input.workspace,
    profile,
    files: {
      gatesFile: input.gatesFilePath,
      statusFile: input.statusFilePath,
    },
    passed: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      blockerCount: blockers.length,
      warningCount: warnings.length,
    },
    release: profile === 'release'
      ? {
        maxArtifactAgeHours: input.maxArtifactAgeHours ?? 168,
        signals: input.releaseSignals ?? [],
      }
      : undefined,
  };
}

export async function publishGateCommand(options: PublishGateCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'gates-file': { type: 'string' },
      'status-file': { type: 'string' },
      profile: { type: 'string' },
      'max-artifact-age-hours': { type: 'string' },
      'live-fire-pointer': { type: 'string' },
      'ab-report': { type: 'string' },
      'use-case-report': { type: 'string' },
      'smoke-report': { type: 'string' },
      'testing-discipline-report': { type: 'string' },
      'testing-tracker-report': { type: 'string' },
      'final-verification-report': { type: 'string' },
      'conversation-insights-file': { type: 'string' },
      'zero-warning': { type: 'boolean', default: false },
      'warn-backlog-drift': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const gatesFilePath = typeof values['gates-file'] === 'string' && values['gates-file'].trim().length > 0
    ? path.resolve(values['gates-file'])
    : path.join(workspace, 'docs', 'librarian', 'GATES.json');
  const statusFilePath = typeof values['status-file'] === 'string' && values['status-file'].trim().length > 0
    ? path.resolve(values['status-file'])
    : path.join(workspace, 'docs', 'librarian', 'STATUS.md');

  const [gatesRaw, statusMarkdown] = await Promise.all([
    readFile(gatesFilePath, 'utf8'),
    readFile(statusFilePath, 'utf8'),
  ]);

  const gates = JSON.parse(gatesRaw) as GatesFile;
  const profileRaw = typeof values.profile === 'string' && values.profile.trim().length > 0
    ? values.profile.trim().toLowerCase()
    : 'release';
  if (profileRaw !== 'broad' && profileRaw !== 'release') {
    throw new Error(`invalid publish-gate profile: ${profileRaw}. expected "broad" or "release"`);
  }
  const profile = profileRaw as PublishGateProfile;
  const maxArtifactAgeHours = typeof values['max-artifact-age-hours'] === 'string' && values['max-artifact-age-hours'].trim().length > 0
    ? Number.parseInt(values['max-artifact-age-hours'], 10)
    : 168;
  if (!Number.isFinite(maxArtifactAgeHours) || maxArtifactAgeHours <= 0) {
    throw new Error('invalid --max-artifact-age-hours value; expected a positive integer');
  }
  const releaseSignals = profile === 'release'
    ? await collectReleaseSignals({
      workspace,
      maxArtifactAgeHours,
      overrides: {
        liveFirePointerPath: typeof values['live-fire-pointer'] === 'string' ? values['live-fire-pointer'] : undefined,
        abReportPath: typeof values['ab-report'] === 'string' ? values['ab-report'] : undefined,
        useCaseReportPath: typeof values['use-case-report'] === 'string' ? values['use-case-report'] : undefined,
        externalSmokeReportPath: typeof values['smoke-report'] === 'string' ? values['smoke-report'] : undefined,
        testingDisciplineReportPath: typeof values['testing-discipline-report'] === 'string'
          ? values['testing-discipline-report']
          : undefined,
        testingTrackerReportPath: typeof values['testing-tracker-report'] === 'string'
          ? values['testing-tracker-report']
          : undefined,
        finalVerificationReportPath: typeof values['final-verification-report'] === 'string'
          ? values['final-verification-report']
          : undefined,
        conversationInsightsPath: typeof values['conversation-insights-file'] === 'string'
          ? values['conversation-insights-file']
          : undefined,
      },
    })
    : undefined;
  let report = evaluatePublishReadiness({
    workspace,
    gatesFilePath,
    statusFilePath,
    gates,
    statusMarkdown,
    profile,
    releaseSignals,
    maxArtifactAgeHours,
    includeBacklogStatusWarning: values['warn-backlog-drift'] as boolean,
  });
  const zeroWarning = values['zero-warning'] as boolean;
  if (zeroWarning && report.warnings.length > 0) {
    const warningBlocker: PublishGateIssue = {
      id: 'release.warning_budget_exceeded',
      scope: 'summary',
      status: 'warnings_present',
      severity: 'blocking',
      count: report.warnings.length,
      message: `${report.warnings.length} warning(s) present while --zero-warning is enabled`,
      hint: 'Resolve all warnings before publish.',
    };
    report = {
      ...report,
      passed: false,
      blockers: [...report.blockers, warningBlocker],
      summary: {
        blockerCount: report.blockers.length + 1,
        warningCount: report.warnings.length,
      },
    };
  }

  const publishGateStateDir = path.join(workspace, 'state', 'eval', 'publish-gate');
  await mkdir(publishGateStateDir, { recursive: true });
  const reportPayload = `${JSON.stringify(report, null, 2)}\n`;
  const createdAtStamp = report.createdAt.replace(/[:.]/g, '-');
  const latestReportPath = path.join(publishGateStateDir, 'latest.json');
  const snapshotReportPath = path.join(publishGateStateDir, `publish-gate-${createdAtStamp}.json`);
  await Promise.all([
    writeFile(latestReportPath, reportPayload, 'utf8'),
    writeFile(snapshotReportPath, reportPayload, 'utf8'),
  ]);

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Publish Gate');
    console.log('============\n');
    console.log(`Workspace: ${workspace}`);
    console.log(`Profile: ${profile}`);
    console.log(`Gate File: ${gatesFilePath}`);
    console.log(`Status File: ${statusFilePath}`);
    if (profile === 'release') {
      console.log(`Release Evidence Max Age (h): ${maxArtifactAgeHours}`);
    }
    console.log(`Result: ${report.passed ? 'pass' : 'fail'}`);
    console.log(`Blockers: ${report.summary.blockerCount}`);
    console.log(`Warnings: ${report.summary.warningCount}`);
    if (report.release && report.release.signals.length > 0) {
      console.log('\nRelease Signals:');
      for (const signal of report.release.signals) {
        const agePart = typeof signal.ageHours === 'number' ? ` (${signal.ageHours.toFixed(1)}h)` : '';
        console.log(`  - [${signal.status}] ${signal.id}${agePart}: ${signal.message}`);
      }
    }
    if (report.blockers.length > 0) {
      console.log('\nBlocking Issues:');
      for (const blocker of report.blockers) {
        const countPart = blocker.count ? ` (${blocker.count})` : '';
        console.log(`  - [${blocker.scope}] ${blocker.status}${countPart}: ${blocker.message}`);
      }
    }
    if (report.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of report.warnings) {
        const countPart = warning.count ? ` (${warning.count})` : '';
        console.log(`  - [${warning.scope}] ${warning.status}${countPart}: ${warning.message}`);
      }
    }
    console.log(`\nReport written: ${latestReportPath}`);
  }

  if (!report.passed) {
    process.exitCode = 1;
  }
}
