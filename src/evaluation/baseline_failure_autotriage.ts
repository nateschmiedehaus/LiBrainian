export type BaselineScopeVerdict = 'must_fix_now' | 'expected_diagnostic' | 'defer_non_scope';

export type BaselineSignalSourceKind =
  | 'test_failure'
  | 'build_error'
  | 'runtime_error'
  | 'diagnostic';

export type BaselineSignalSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface BaselineFailureSignal {
  key: string;
  verdict: BaselineScopeVerdict;
  sourceKind: BaselineSignalSourceKind;
  severity: BaselineSignalSeverity;
  summary: string;
  detail: string;
  filePath?: string;
  evidenceLines: string[];
  suggestedCommands: string[];
}

export interface BaselineFollowUpAction {
  key: string;
  verdict: Exclude<BaselineScopeVerdict, 'expected_diagnostic'>;
  summary: string;
  command?: string;
}

export interface BaselineFailureTriageSummary {
  totalSignals: number;
  mustFixNow: number;
  deferNonScope: number;
  expectedDiagnostic: number;
}

export interface BaselineFailureTriageResult {
  kind: 'BaselineFailureTriage.v1';
  generatedAt: string;
  summary: BaselineFailureTriageSummary;
  scopePaths: string[];
  mustFixNow: BaselineFailureSignal[];
  deferNonScope: BaselineFailureSignal[];
  expectedDiagnostic: BaselineFailureSignal[];
  immediateFollowUp: BaselineFollowUpAction[];
}

export interface BuildBaselineFailureTriageOptions {
  scopePaths?: string[];
}

export interface DeferredIssueCandidate {
  key: string;
  marker: string;
  title: string;
  body: string;
  labels: string[];
  milestone?: string;
}

export interface BuildDeferredIssueOptions {
  scopePaths?: string[];
  sourceLogPath?: string;
  issueMilestone?: string;
}

const TEST_FAIL_PATTERN = /^\s*FAIL\s+([^\s>]+)(?:\s+>|$)/;
const TS_ERROR_PATTERN = /^([^:\n]+)\((\d+),(\d+)\):\s+error\s+TS\d+:/;
const RUNTIME_ERROR_PATTERNS: RegExp[] = [
  /^npm ERR!/i,
  /^Error:\s+/,
  /Command failed with exit code/i,
];

const EXPECTED_DIAGNOSTIC_PATTERNS: RegExp[] = [
  /^stderr\s+\|\s+/i,
  /^SKIP:/i,
  /LLM not configured; running without synthesis/i,
  /Semantic indexing: no files processed and no functions indexed/i,
  /\[validation\]\s+Fatal postcondition failed:/i,
  /\[validation\]\s+Fatal precondition failed:/i,
  /unverified_by_trace\(/i,
];

function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized.replace(/\/+/g, '/');
}

function toStableKey(prefix: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${prefix}-${slug || 'signal'}`;
}

function normalizeScopePaths(paths: string[]): string[] {
  const normalized = new Set<string>();
  for (const candidate of paths) {
    if (!candidate || !candidate.trim()) continue;
    normalized.add(normalizePath(candidate));
  }
  return Array.from(normalized);
}

function isFileInScope(filePath: string | undefined, scopePaths: string[]): boolean {
  if (!filePath) return scopePaths.length === 0;
  if (scopePaths.length === 0) return true;

  const target = normalizePath(filePath);
  for (const rawScope of scopePaths) {
    const scope = normalizePath(rawScope);
    if (target === scope) return true;
    if (target.endsWith(`/${scope}`)) return true;
    if (scope.endsWith('/') && target.startsWith(scope)) return true;
    if (!scope.endsWith('/') && target.startsWith(`${scope}/`)) return true;
  }
  return false;
}

function buildFailureSignalFromLine(line: string): Omit<BaselineFailureSignal, 'verdict'> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const testMatch = trimmed.match(TEST_FAIL_PATTERN);
  if (testMatch?.[1]) {
    const filePath = normalizePath(testMatch[1]);
    return {
      key: toStableKey('test-failure', filePath),
      sourceKind: 'test_failure',
      severity: 'high',
      summary: `Test failure: ${filePath}`,
      detail: trimmed,
      filePath,
      evidenceLines: [trimmed],
      suggestedCommands: [`npm test -- --run ${filePath}`],
    };
  }

  const tsErrorMatch = trimmed.match(TS_ERROR_PATTERN);
  if (tsErrorMatch?.[1]) {
    const filePath = normalizePath(tsErrorMatch[1]);
    return {
      key: toStableKey('build-error', filePath),
      sourceKind: 'build_error',
      severity: 'high',
      summary: `TypeScript build failure: ${filePath}`,
      detail: trimmed,
      filePath,
      evidenceLines: [trimmed],
      suggestedCommands: ['npm run build'],
    };
  }

  for (const pattern of RUNTIME_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        key: toStableKey('runtime-error', trimmed),
        sourceKind: 'runtime_error',
        severity: 'critical',
        summary: 'Runtime command failure detected',
        detail: trimmed,
        evidenceLines: [trimmed],
        suggestedCommands: [],
      };
    }
  }

  return null;
}

function buildDiagnosticSignal(line: string): BaselineFailureSignal {
  const trimmed = line.trim();
  return {
    key: toStableKey('diagnostic', trimmed),
    verdict: 'expected_diagnostic',
    sourceKind: 'diagnostic',
    severity: 'low',
    summary: 'Expected diagnostic output',
    detail: trimmed,
    evidenceLines: [trimmed],
    suggestedCommands: [],
  };
}

function dedupeSignals(signals: BaselineFailureSignal[]): BaselineFailureSignal[] {
  const deduped = new Map<string, BaselineFailureSignal>();
  for (const signal of signals) {
    if (!deduped.has(signal.key)) {
      deduped.set(signal.key, signal);
      continue;
    }

    const existing = deduped.get(signal.key);
    if (!existing) continue;
    const combinedEvidence = new Set<string>([...existing.evidenceLines, ...signal.evidenceLines]);
    const combinedCommands = new Set<string>([...existing.suggestedCommands, ...signal.suggestedCommands]);
    deduped.set(signal.key, {
      ...existing,
      evidenceLines: Array.from(combinedEvidence),
      suggestedCommands: Array.from(combinedCommands),
    });
  }
  return Array.from(deduped.values());
}

function buildFollowUpQueue(mustFixNow: BaselineFailureSignal[], deferNonScope: BaselineFailureSignal[]): BaselineFollowUpAction[] {
  const actions: BaselineFollowUpAction[] = [];

  for (const signal of mustFixNow) {
    const command = signal.suggestedCommands[0];
    actions.push({
      key: signal.key,
      verdict: 'must_fix_now',
      summary: signal.summary,
      command,
    });
  }

  for (const signal of deferNonScope) {
    actions.push({
      key: signal.key,
      verdict: 'defer_non_scope',
      summary: `Track baseline and schedule fix: ${signal.summary}`,
      command: signal.suggestedCommands[0],
    });
  }

  return actions;
}

export function buildBaselineFailureTriage(
  rawOutput: string,
  options: BuildBaselineFailureTriageOptions = {},
): BaselineFailureTriageResult {
  const scopePaths = normalizeScopePaths(options.scopePaths ?? []);
  const lines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const classified: BaselineFailureSignal[] = [];
  const diagnostics: BaselineFailureSignal[] = [];

  for (const line of lines) {
    const candidate = buildFailureSignalFromLine(line);
    if (candidate) {
      const inScope = isFileInScope(candidate.filePath, scopePaths);
      classified.push({
        ...candidate,
        verdict: inScope ? 'must_fix_now' : 'defer_non_scope',
      });
      continue;
    }

    if (EXPECTED_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(line))) {
      diagnostics.push(buildDiagnosticSignal(line));
    }
  }

  const dedupedClassified = dedupeSignals(classified);
  const dedupedDiagnostics = dedupeSignals(diagnostics);

  const mustFixNow = dedupedClassified.filter((signal) => signal.verdict === 'must_fix_now');
  const deferNonScope = dedupedClassified.filter((signal) => signal.verdict === 'defer_non_scope');

  return {
    kind: 'BaselineFailureTriage.v1',
    generatedAt: new Date().toISOString(),
    summary: {
      totalSignals: mustFixNow.length + deferNonScope.length + dedupedDiagnostics.length,
      mustFixNow: mustFixNow.length,
      deferNonScope: deferNonScope.length,
      expectedDiagnostic: dedupedDiagnostics.length,
    },
    scopePaths,
    mustFixNow,
    deferNonScope,
    expectedDiagnostic: dedupedDiagnostics,
    immediateFollowUp: buildFollowUpQueue(mustFixNow, deferNonScope),
  };
}

function severityToPriorityLabel(severity: BaselineSignalSeverity): string {
  if (severity === 'critical' || severity === 'high') return 'priority: high';
  if (severity === 'medium') return 'priority: medium';
  return 'priority: low';
}

export function buildDeferredIssueCandidate(
  signal: BaselineFailureSignal,
  options: BuildDeferredIssueOptions = {},
): DeferredIssueCandidate {
  const marker = `[baseline-failure:${signal.key}]`;
  const labels = [
    severityToPriorityLabel(signal.severity),
    'area: testing',
    'agent/actionable',
    'triage/missing-essentials',
  ];

  const evidence = signal.evidenceLines.length > 0
    ? signal.evidenceLines.slice(0, 20)
    : [signal.detail];
  const scopeText = (options.scopePaths ?? []).length > 0
    ? options.scopePaths!.join(', ')
    : 'none provided';
  const recommendedCommands = signal.suggestedCommands.length > 0
    ? signal.suggestedCommands
    : ['Reproduce and isolate failing command output'];

  const lines: string[] = [];
  lines.push(`## Baseline Failure`);
  lines.push('');
  lines.push(`**Summary:** ${signal.summary}`);
  lines.push(`**Source kind:** \`${signal.sourceKind}\``);
  lines.push(`**Scope verdict:** \`${signal.verdict}\``);
  lines.push(`**File:** ${signal.filePath ?? 'n/a'}`);
  lines.push(`**Active scope when observed:** ${scopeText}`);
  if (options.sourceLogPath) {
    lines.push(`**Source log:** ${options.sourceLogPath}`);
  }
  lines.push('');
  lines.push('## Evidence');
  lines.push('```text');
  lines.push(...evidence);
  lines.push('```');
  lines.push('');
  lines.push('## Immediate Follow-Up');
  for (const command of recommendedCommands) {
    lines.push(`- [ ] Run \`${command}\``);
  }
  lines.push('- [ ] Confirm whether failure reproduces on current main branch.');
  lines.push('- [ ] Land fix with regression coverage and close this issue with verification evidence.');
  lines.push('');
  lines.push(marker);

  return {
    key: signal.key,
    marker,
    title: `[BASELINE] ${signal.summary}`.slice(0, 120),
    body: `${lines.join('\n')}\n`,
    labels,
    milestone: options.issueMilestone,
  };
}
