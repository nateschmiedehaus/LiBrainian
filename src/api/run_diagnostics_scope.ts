export type RepositoryRole = 'core' | 'client';
export type ScopeVerdict = 'clean' | 'expected_diagnostic' | 'defer_non_scope' | 'must_fix_now';
export type FindingClass = 'must_fix_now' | 'expected_diagnostic' | 'defer_non_scope';
export type FixQueuePriority = 'critical' | 'high' | 'medium';
export type FixQueueCategory =
  | 'missing_command'
  | 'build_failure'
  | 'type_error'
  | 'test_failure'
  | 'configuration'
  | 'runtime_error'
  | 'unknown';

export interface BaselineIssueRef {
  pattern: string;
  issue?: string;
  note?: string;
}

export interface CommandDiagnosticResult {
  command: string;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  durationMs?: number;
}

export interface RunDiagnosticsScopeInput {
  repositoryRole: RepositoryRole;
  commandResults: CommandDiagnosticResult[];
  baselineIssueRefs?: BaselineIssueRef[];
  maxFindingsPerCommand?: number;
}

export interface ScopedDiagnosticFinding {
  class: FindingClass;
  command: string;
  reason: string;
  sample: string;
  linkedIssue?: string;
  confidence: 'high' | 'medium';
}

export interface AutonomousFixQueueItem {
  priority: FixQueuePriority;
  category: FixQueueCategory;
  title: string;
  rationale: string;
  commands: string[];
  evidence: string[];
  appliesTo: 'core' | 'client' | 'shared';
}

export type DeferredIssueAction = 'link_existing_issue' | 'create_or_update_issue';

export interface DeferredIssueQueueItem {
  action: DeferredIssueAction;
  key: string;
  issue?: string;
  title: string;
  rationale: string;
  labels: string[];
  evidence: string[];
  commands: string[];
  appliesTo: 'core' | 'client' | 'shared';
}

export interface RunDiagnosticsScopeReport {
  kind: 'RunDiagnosticsScopeReport.v1';
  repositoryRole: RepositoryRole;
  overallVerdict: ScopeVerdict;
  summary: {
    commandCount: number;
    mustFixNowCount: number;
    expectedDiagnosticCount: number;
    deferNonScopeCount: number;
  };
  mustFixNow: ScopedDiagnosticFinding[];
  expectedDiagnostics: ScopedDiagnosticFinding[];
  deferNonScope: ScopedDiagnosticFinding[];
  fixQueue: AutonomousFixQueueItem[];
  deferIssueQueue: DeferredIssueQueueItem[];
  generatedAt: string;
}

interface ParsedLine {
  text: string;
  source: 'stdout' | 'stderr';
}

const DEFAULT_MAX_FINDINGS_PER_COMMAND = 3;

const EXPECTED_DIAGNOSTIC_PATTERNS: RegExp[] = [
  /^stderr\s*\|/iu,
  /LLM not configured; running without synthesis/iu,
  /Composition selection fallback/iu,
  /\[parallel_operator\] checkpoint outputs truncated/iu,
  /Semantic indexing: no files processed and no functions indexed/iu,
  /^SKIP:/iu,
  /Recovered stale lock state before acquisition/iu,
  /Query stage observer failed/iu,
  /\[FileWatcher\] Handler error/iu,
  /Could not analyze .*Cannot read file/iu,
  /\[validation\] Fatal (?:precondition|postcondition) failed:/iu,
];

const STRONG_FAILURE_PATTERNS: Array<{ regex: RegExp; category: FixQueueCategory; reason: string }> = [
  { regex: /command not found/iu, category: 'missing_command', reason: 'required command is missing from PATH or not installed' },
  { regex: /npm ERR!/iu, category: 'build_failure', reason: 'npm reported a build/runtime failure' },
  { regex: /error TS\d+/u, category: 'type_error', reason: 'TypeScript compilation error detected' },
  { regex: /Cannot find module/iu, category: 'build_failure', reason: 'runtime/module resolution failed' },
  { regex: /\bFAIL\b/u, category: 'test_failure', reason: 'test failure marker detected' },
  { regex: /\b(fatal|unhandled rejection|segmentation fault)\b/iu, category: 'runtime_error', reason: 'fatal runtime failure detected' },
];

function splitLines(input: string | undefined, source: 'stdout' | 'stderr'): ParsedLine[] {
  if (!input) return [];
  return input
    .split('\n')
    .map((line) => line.replace(/\r/gu, '').trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text, source }));
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function classifyFailureCategory(line: string): { category: FixQueueCategory; reason: string } | null {
  for (const candidate of STRONG_FAILURE_PATTERNS) {
    if (candidate.regex.test(line)) {
      return { category: candidate.category, reason: candidate.reason };
    }
  }
  return null;
}

function isExpectedDiagnostic(line: string): boolean {
  return EXPECTED_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(line));
}

function isLikelyTestTitle(line: string): boolean {
  return /^stderr\s*\|/iu.test(line)
    || (/\s>\s/u.test(line) && /\b(FAIL|PASS)\b/u.test(line));
}

function matchBaselineIssue(line: string, refs: BaselineIssueRef[]): BaselineIssueRef | null {
  const normalizedLine = normalize(line);
  for (const ref of refs) {
    if (normalizedLine.includes(normalize(ref.pattern))) {
      return ref;
    }
  }
  return null;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function queueCommandsForCategory(category: FixQueueCategory): string[] {
  switch (category) {
    case 'missing_command':
      return ['npm install', 'npm run hooks:install', 'verify required CLI scripts are resolvable from PATH'];
    case 'type_error':
      return ['npm run build', 'fix reported TypeScript errors before re-running tests'];
    case 'test_failure':
      return ['npm test -- --run <failing test file>', 'add or update regression tests with issue-linked scope'];
    case 'build_failure':
      return ['npm run build', 'resolve dependency/runtime import failures and re-run'];
    case 'configuration':
      return ['LiBrainian diagnose --config --format json', 'apply explicit provider/config values for this workspace'];
    case 'runtime_error':
      return ['re-run command with minimal scope to isolate failure', 'collect failing stack frame and owning module'];
    default:
      return ['re-run failing command with focused scope', 'convert repeated failure into a tracked issue with evidence'];
  }
}

function priorityForCategory(category: FixQueueCategory): FixQueuePriority {
  switch (category) {
    case 'missing_command':
      return 'critical';
    case 'build_failure':
    case 'type_error':
    case 'runtime_error':
      return 'high';
    case 'test_failure':
    case 'configuration':
    case 'unknown':
    default:
      return 'medium';
  }
}

function appliesTo(category: FixQueueCategory, repositoryRole: RepositoryRole): 'core' | 'client' | 'shared' {
  if (category === 'missing_command' || category === 'configuration') {
    return 'shared';
  }
  return repositoryRole;
}

function queueSortValue(priority: FixQueuePriority): number {
  if (priority === 'critical') return 0;
  if (priority === 'high') return 1;
  return 2;
}

function truncateFindings(findings: ScopedDiagnosticFinding[], limit: number): ScopedDiagnosticFinding[] {
  if (findings.length <= limit) return findings;
  return findings.slice(0, limit);
}

function buildFixQueue(repositoryRole: RepositoryRole, findings: ScopedDiagnosticFinding[]): AutonomousFixQueueItem[] {
  const bucket = new Map<string, AutonomousFixQueueItem>();

  for (const finding of findings) {
    const classified = classifyFailureCategory(finding.sample);
    const category = classified?.category ?? 'unknown';
    const priority = priorityForCategory(category);
    const key = `${priority}:${category}`;

    const existing = bucket.get(key);
    if (existing) {
      existing.evidence = dedupeStrings([...existing.evidence, finding.sample]);
      continue;
    }

    const rationale = classified?.reason ?? finding.reason;
    bucket.set(key, {
      priority,
      category,
      title: `Resolve ${category.replace(/_/gu, ' ')} before closing issue`,
      rationale,
      commands: queueCommandsForCategory(category),
      evidence: [finding.sample],
      appliesTo: appliesTo(category, repositoryRole),
    });
  }

  return Array.from(bucket.values())
    .map((item) => ({
      ...item,
      evidence: dedupeStrings(item.evidence).slice(0, 5),
    }))
    .sort((a, b) => {
      const diff = queueSortValue(a.priority) - queueSortValue(b.priority);
      if (diff !== 0) return diff;
      const categoryCompare = a.category.localeCompare(b.category);
      if (categoryCompare !== 0) return categoryCompare;
      return a.title.localeCompare(b.title);
    });
}

function deferredIssueTitleFromSample(sample: string): string {
  const sanitized = sample.replace(/\s+/gu, ' ').trim();
  if (sanitized.length <= 100) {
    return `Track deferred baseline failure: ${sanitized}`;
  }
  return `Track deferred baseline failure: ${sanitized.slice(0, 97)}...`;
}

function buildDeferredIssueQueue(repositoryRole: RepositoryRole, findings: ScopedDiagnosticFinding[]): DeferredIssueQueueItem[] {
  const linked = new Map<string, DeferredIssueQueueItem>();
  const unlinked = new Map<string, DeferredIssueQueueItem>();

  for (const finding of findings) {
    const keyBase = finding.sample.toLowerCase().replace(/\s+/gu, ' ').trim();

    if (finding.linkedIssue && finding.linkedIssue.trim().length > 0) {
      const issue = finding.linkedIssue.trim();
      const existing = linked.get(issue);
      if (existing) {
        existing.evidence = dedupeStrings([...existing.evidence, finding.sample]).slice(0, 5);
        existing.commands = dedupeStrings([...existing.commands, finding.command]).slice(0, 5);
        continue;
      }

      linked.set(issue, {
        action: 'link_existing_issue',
        key: `issue:${issue}`,
        issue,
        title: `Link deferred diagnostics to ${issue}`,
        rationale: 'deferred diagnostics already mapped to an existing baseline issue',
        labels: ['triage/deferred', 'scope/baseline', `repo/${repositoryRole}`],
        evidence: [finding.sample],
        commands: [finding.command],
        appliesTo: repositoryRole,
      });
      continue;
    }

    const key = `signature:${keyBase}`;
    const existing = unlinked.get(key);
    if (existing) {
      existing.evidence = dedupeStrings([...existing.evidence, finding.sample]).slice(0, 5);
      existing.commands = dedupeStrings([...existing.commands, finding.command]).slice(0, 5);
      continue;
    }

    unlinked.set(key, {
      action: 'create_or_update_issue',
      key,
      title: deferredIssueTitleFromSample(finding.sample),
      rationale: 'deferred diagnostics have no linked issue and require tracked follow-up',
      labels: ['triage/deferred', 'scope/baseline', `repo/${repositoryRole}`],
      evidence: [finding.sample],
      commands: [finding.command],
      appliesTo: repositoryRole,
    });
  }

  return [...linked.values(), ...unlinked.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function overallVerdictFromCounts(mustFix: number, expected: number, deferred: number): ScopeVerdict {
  if (mustFix > 0) return 'must_fix_now';
  if (deferred > 0 && expected === 0) return 'defer_non_scope';
  if (expected > 0) return 'expected_diagnostic';
  if (deferred > 0) return 'defer_non_scope';
  return 'clean';
}

export function classifyRunDiagnosticsScope(input: RunDiagnosticsScopeInput): RunDiagnosticsScopeReport {
  const baselineIssueRefs = input.baselineIssueRefs ?? [];
  const maxFindingsPerCommand = input.maxFindingsPerCommand ?? DEFAULT_MAX_FINDINGS_PER_COMMAND;

  const mustFixNow: ScopedDiagnosticFinding[] = [];
  const expectedDiagnostics: ScopedDiagnosticFinding[] = [];
  const deferNonScope: ScopedDiagnosticFinding[] = [];

  for (const commandResult of input.commandResults) {
    const lines = [
      ...splitLines(commandResult.stderr, 'stderr'),
      ...splitLines(commandResult.stdout, 'stdout'),
    ];

    const commandMustFix: ScopedDiagnosticFinding[] = [];
    const commandExpected: ScopedDiagnosticFinding[] = [];
    const commandDeferred: ScopedDiagnosticFinding[] = [];

    if (commandResult.timedOut) {
      commandMustFix.push({
        class: 'must_fix_now',
        command: commandResult.command,
        reason: 'command timed out and must be stabilized',
        sample: `timeout: ${commandResult.command}`,
        confidence: 'high',
      });
    }

    for (const line of lines) {
      const baselineRef = matchBaselineIssue(line.text, baselineIssueRefs);
      if (baselineRef) {
        commandDeferred.push({
          class: 'defer_non_scope',
          command: commandResult.command,
          reason: 'matches known baseline issue mapped for deferred follow-up',
          sample: line.text,
          linkedIssue: baselineRef.issue,
          confidence: 'high',
        });
        continue;
      }

      const failure = classifyFailureCategory(line.text);
      if (failure) {
        if (commandResult.exitCode === 0 && !/command not found|error TS\d+|Cannot find module/iu.test(line.text)) {
          commandExpected.push({
            class: 'expected_diagnostic',
            command: commandResult.command,
            reason: 'failure-like marker observed in passing command output; treated as diagnostic test noise',
            sample: line.text,
            confidence: isLikelyTestTitle(line.text) ? 'high' : 'medium',
          });
          continue;
        }

        commandMustFix.push({
          class: 'must_fix_now',
          command: commandResult.command,
          reason: failure.reason,
          sample: line.text,
          confidence: 'high',
        });
        continue;
      }

      if (isExpectedDiagnostic(line.text)) {
        commandExpected.push({
          class: 'expected_diagnostic',
          command: commandResult.command,
          reason: 'recognized expected diagnostic stderr pattern',
          sample: line.text,
          confidence: 'high',
        });
      }
    }

    if ((commandResult.exitCode ?? 0) !== 0 && commandMustFix.length === 0) {
      if (commandDeferred.length > 0) {
        // Keep deferred evidence minimal when baseline mappings already explain the failure.
      } else {
        commandMustFix.push({
          class: 'must_fix_now',
          command: commandResult.command,
          reason: 'non-zero exit code with unclassified failure; treat as actionable',
          sample: `exit_code=${String(commandResult.exitCode)}`,
          confidence: 'medium',
        });
      }
    }

    if ((commandResult.exitCode ?? 0) === 0 && commandMustFix.length === 0 && commandExpected.length === 0 && lines.length === 0) {
      // Clean command output: no finding emitted.
    }

    mustFixNow.push(...truncateFindings(commandMustFix, maxFindingsPerCommand));
    expectedDiagnostics.push(...truncateFindings(commandExpected, maxFindingsPerCommand));
    deferNonScope.push(...truncateFindings(commandDeferred, maxFindingsPerCommand));
  }

  const fixQueue = buildFixQueue(input.repositoryRole, mustFixNow);
  const deferIssueQueue = buildDeferredIssueQueue(input.repositoryRole, deferNonScope);
  const overallVerdict = overallVerdictFromCounts(mustFixNow.length, expectedDiagnostics.length, deferNonScope.length);

  return {
    kind: 'RunDiagnosticsScopeReport.v1',
    repositoryRole: input.repositoryRole,
    overallVerdict,
    summary: {
      commandCount: input.commandResults.length,
      mustFixNowCount: mustFixNow.length,
      expectedDiagnosticCount: expectedDiagnostics.length,
      deferNonScopeCount: deferNonScope.length,
    },
    mustFixNow,
    expectedDiagnostics,
    deferNonScope,
    fixQueue,
    deferIssueQueue,
    generatedAt: new Date().toISOString(),
  };
}
