#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPORT = 'state/e2e/outcome-report.json';
const DEFAULT_ARTIFACT = 'state/e2e/outcome-triage.json';
const DEFAULT_MARKDOWN = 'state/e2e/outcome-triage.md';
const DEFAULT_PLAN_ARTIFACT = 'state/plans/agent-issue-fix-plan.json';
const DEFAULT_PLAN_MARKDOWN = 'state/plans/agent-issue-fix-plan.md';
const DEFAULT_MAX_ISSUES = 5;

export function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
    artifact: DEFAULT_ARTIFACT,
    markdown: DEFAULT_MARKDOWN,
    createGhIssues: true,
    includeImmediate: true,
    repo: process.env.GITHUB_REPOSITORY || '',
    maxIssues: DEFAULT_MAX_ISSUES,
    planArtifact: null,
    planMarkdown: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--report') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --report');
      options.report = value;
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
    if (arg === '--repo') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --repo');
      options.repo = value;
      i += 1;
      continue;
    }
    if (arg === '--max-issues') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --max-issues');
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --max-issues value: ${value}`);
      options.maxIssues = parsed;
      i += 1;
      continue;
    }
    if (arg === '--plan-artifact') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --plan-artifact');
      options.planArtifact = value;
      i += 1;
      continue;
    }
    if (arg === '--plan-markdown') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --plan-markdown');
      options.planMarkdown = value;
      i += 1;
      continue;
    }
    if (arg === '--create-gh-issues') {
      options.createGhIssues = true;
      continue;
    }
    if (arg === '--no-create-gh-issues') {
      options.createGhIssues = false;
      continue;
    }
    if (arg === '--include-immediate') {
      options.includeImmediate = true;
      continue;
    }
    if (arg === '--exclude-immediate') {
      options.includeImmediate = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
  if (result.status !== 0) {
    const stdout = String(result.stdout ?? '').trim();
    const stderr = String(result.stderr ?? '').trim();
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${combined ? `\n${combined}` : ''}`);
  }
  return String(result.stdout ?? '').trim();
}

async function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return JSON.parse(await fs.readFile(absolutePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function writeMarkdown(filePath, payload) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, payload, 'utf8');
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function classifyFailure(failure) {
  const text = String(failure);
  if (text.includes('reliability_lift_below_threshold')) {
    return {
      key: 'reliability-lift-negative',
      severity: 'critical',
      immediate: true,
      summary: 'Treatment reliability is below control in outcome E2E.',
      relatedIssues: [564],
    };
  }
  if (text.startsWith('execution_error:')) {
    return {
      key: 'outcome-harness-execution-error',
      severity: 'critical',
      immediate: true,
      summary: 'Outcome harness execution failed before reliable gating.',
      relatedIssues: [564],
    };
  }
  if (text.includes('freshness:')) {
    return {
      key: 'outcome-evidence-freshness',
      severity: 'high',
      immediate: false,
      summary: 'Outcome evidence freshness failed or is missing.',
      relatedIssues: [563, 564],
    };
  }
  if (text.includes('insufficient_natural_tasks') || text.includes('insufficient_natural_repos') || text.includes('insufficient_paired_tasks')) {
    return {
      key: 'outcome-sample-size-insufficient',
      severity: 'high',
      immediate: false,
      summary: 'Outcome sample size/repo diversity is below required threshold.',
      relatedIssues: [564],
    };
  }
  if (text.includes('insufficient_evidence_links')) {
    return {
      key: 'outcome-evidence-links-insufficient',
      severity: 'medium',
      immediate: false,
      summary: 'Outcome runs do not link enough per-task evidence artifacts.',
      relatedIssues: [564],
    };
  }
  if (text.includes('agent_critique_share_below_threshold')) {
    return {
      key: 'outcome-agent-critique-insufficient',
      severity: 'high',
      immediate: false,
      summary: 'External agent critique coverage is below threshold.',
      relatedIssues: [564],
    };
  }
  if (text.includes('exploration_findings_below_threshold')) {
    return {
      key: 'outcome-exploration-findings-missing',
      severity: 'high',
      immediate: false,
      summary: 'Exploratory diagnostics produced too few findings to be trusted.',
      relatedIssues: [564],
    };
  }
  if (text.includes('time_reduction_below_threshold')) {
    return {
      key: 'outcome-time-reduction-regressed',
      severity: 'medium',
      immediate: false,
      summary: 'Treatment time reduction is below threshold.',
      relatedIssues: [564],
    };
  }
  return {
    key: `outcome-${slugify(text) || 'generic-failure'}`,
    severity: 'medium',
    immediate: false,
    summary: text,
    relatedIssues: [564],
  };
}

function toPriorityLabel(severity) {
  if (severity === 'critical') return 'priority: high';
  if (severity === 'high') return 'priority: high';
  if (severity === 'medium') return 'priority: medium';
  return 'priority: low';
}

function dedupeByKey(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.key)) map.set(item.key, item);
  }
  return Array.from(map.values());
}

function severityRank(severity) {
  if (severity === 'critical') return 0;
  if (severity === 'high') return 1;
  if (severity === 'medium') return 2;
  return 3;
}

function severityPriority(severity, immediate) {
  if (immediate) return 'P0';
  if (severity === 'critical') return 'P1';
  if (severity === 'high') return 'P1';
  if (severity === 'medium') return 'P2';
  return 'P3';
}

function dedupeStrings(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    deduped.push(text);
  }
  return deduped;
}

function buildVerificationCommands(key) {
  const commands = [
    'npm run test:e2e:outcome',
    'npm run test:e2e:triage',
    'npm run test:e2e:full:quick',
  ];
  if (/reliability|time|sample|exploration|critique/i.test(key)) {
    commands.push('npm run eval:use-cases:agentic:quick');
  }
  if (/reliability|time/i.test(key)) {
    commands.push('npm run test:e2e:diagnostic:ab:quick');
  }
  return dedupeStrings(commands);
}

function countPatternHits(values, pattern) {
  let count = 0;
  for (const value of values) {
    if (pattern.test(String(value))) count += 1;
  }
  return count;
}

function buildExperienceFindings(report, suggestions, noteworthyObservations, painPoints, improvementIdeas) {
  const corpus = []
    .concat(noteworthyObservations)
    .concat(painPoints)
    .concat(improvementIdeas);
  const findings = [];

  const gitMetadataHits = countPatternHits(corpus, /\bnot a git repository\b|\.git metadata|missing git|git diff --name-only/i);
  if (gitMetadataHits > 0) {
    findings.push({
      key: 'theme-workspace-git-metadata-missing',
      severity: gitMetadataHits >= 4 ? 'high' : 'medium',
      immediate: false,
      summary: 'External workspace snapshots are missing Git metadata required by task verification flows.',
      source: 'experience_theme',
      detail: `Detected ${gitMetadataHits} observation(s) indicating missing .git metadata or failing git verification commands.`,
      suggestions,
      noteworthyObservations,
      painPoints,
      improvementIdeas,
      evidenceLinks: [],
      relatedIssues: [564],
    });
  }

  const missingHintHits = countPatternHits(corpus, /\bno librarian hints\b|minimal.*hint|context was minimal/i);
  if (missingHintHits > 0) {
    findings.push({
      key: 'theme-librainian-hints-insufficient',
      severity: 'medium',
      immediate: false,
      summary: 'LiBrainian localization hints/context were missing or too thin in multiple treatment runs.',
      source: 'experience_theme',
      detail: `Detected ${missingHintHits} observation(s) about insufficient LiBrainian hint quality/coverage.`,
      suggestions,
      noteworthyObservations,
      painPoints,
      improvementIdeas,
      evidenceLinks: [],
      relatedIssues: [564],
    });
  }

  const blockedVerificationHits = countPatternHits(corpus, /\bno automated tests executed\b|allow running.*vitest|test coverage.*unchecked/i);
  if (blockedVerificationHits > 0) {
    findings.push({
      key: 'theme-harness-verification-flow-friction',
      severity: 'medium',
      immediate: false,
      summary: 'Harness verification flow blocked meaningful in-repo test execution in multiple runs.',
      source: 'experience_theme',
      detail: `Detected ${blockedVerificationHits} observation(s) where verification policy prevented or discouraged targeted test execution.`,
      suggestions,
      noteworthyObservations,
      painPoints,
      improvementIdeas,
      evidenceLinks: [],
      relatedIssues: [564],
    });
  }

  return findings;
}

function isGhAvailable(repo) {
  if (!repo) return false;
  const binary = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (binary.status !== 0) return false;
  const auth = spawnSync('gh', ['auth', 'status', '-h', 'github.com'], { encoding: 'utf8', stdio: 'pipe' });
  return auth.status === 0;
}

function buildMetaFinding(report, suggestions, noteworthyObservations, painPoints, improvementIdeas) {
  const status = String(report?.status ?? 'unknown');
  const runClass = status === 'passed' ? 'maintenance' : 'remediation';
  const details = [
    `Outcome report status: ${status}`,
    `Failure count: ${Array.isArray(report?.failures) ? report.failures.length : 0}`,
    `Diagnosis count: ${Array.isArray(report?.diagnoses) ? report.diagnoses.length : 0}`,
    `Natural tasks observed: ${Number.isFinite(Number(report?.sample?.naturalTaskCount)) ? Number(report.sample.naturalTaskCount) : 0}`,
    `Paired tasks observed: ${Number.isFinite(Number(report?.sample?.pairedTaskCount)) ? Number(report.sample.pairedTaskCount) : 0}`,
  ];
  return {
    key: 'meta-e2e-remediation-loop',
    severity: status === 'passed' ? 'medium' : 'high',
    immediate: false,
    summary: `E2E ${runClass}: maintain root-cause remediation backlog and patrol follow-through`,
    source: 'meta',
    detail: details.join('\n'),
    suggestions,
    noteworthyObservations,
    painPoints,
    improvementIdeas,
    evidenceLinks: [],
    relatedIssues: [564],
  };
}

export function buildTriage(report) {
  const failures = Array.isArray(report.failures) ? report.failures : [];
  const diagnoses = Array.isArray(report.diagnoses) ? report.diagnoses : [];
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];

  const noteworthyObservations = Array.isArray(report.agentExperience?.noteworthyObservations)
    ? report.agentExperience.noteworthyObservations
    : [];
  const painPoints = Array.isArray(report.agentExperience?.painPoints)
    ? report.agentExperience.painPoints
    : [];
  const improvementIdeas = Array.isArray(report.agentExperience?.improvementIdeas)
    ? report.agentExperience.improvementIdeas
    : [];

  const findings = failures.map((failure) => {
    const classified = classifyFailure(failure);
    return {
      ...classified,
      source: 'failure',
      detail: String(failure),
      suggestions,
      noteworthyObservations,
      painPoints,
      improvementIdeas,
      evidenceLinks: Array.isArray(report.controlVsTreatment?.topRegressions)
        ? report.controlVsTreatment.topRegressions
          .map((entry) => entry?.evidence)
          .filter((value) => typeof value === 'string' && value.length > 0)
          .slice(0, 5)
        : [],
    };
  });

  const diagnosisFindings = diagnoses.map((diagnosis) => ({
    key: `diagnosis-${slugify(diagnosis) || 'generic'}`,
    severity: 'medium',
    immediate: false,
    summary: String(diagnosis),
    source: 'diagnosis',
    detail: String(diagnosis),
    suggestions,
    noteworthyObservations,
    painPoints,
    improvementIdeas,
    evidenceLinks: [],
    relatedIssues: [564],
  }));

  const experienceFindings = buildExperienceFindings(
    report,
    suggestions,
    noteworthyObservations,
    painPoints,
    improvementIdeas
  );

  const mergedBase = dedupeByKey(findings.concat(diagnosisFindings, experienceFindings));
  const shouldAddMetaFinding = mergedBase.length > 0 || String(report?.status ?? 'unknown') !== 'passed';
  const merged = shouldAddMetaFinding
    ? dedupeByKey([
      ...mergedBase,
      buildMetaFinding(report, suggestions, noteworthyObservations, painPoints, improvementIdeas),
    ])
    : mergedBase;
  const immediateActions = merged.filter((item) => item.immediate);
  const issueCandidates = merged
    .filter((item) => !item.immediate)
    .map((item) => ({
      ...item,
      accepted: true,
      acceptanceReason: 'default_accepted',
    }));

  return {
    schema_version: 1,
    kind: 'E2EOutcomeTriage.v1',
    createdAt: new Date().toISOString(),
    reportStatus: String(report.status ?? 'unknown'),
    sourceReport: {
      kind: String(report.kind ?? 'unknown'),
      createdAt: String(report.createdAt ?? ''),
    },
    summary: {
      findings: merged.length,
      immediateActions: immediateActions.length,
      issueCandidates: issueCandidates.length,
    },
    immediateActions,
    issueCandidates,
  };
}

function buildIssueTitle(finding) {
  return `E2E diagnosis: ${finding.summary}`;
}

function buildIssueBody(finding) {
  const lines = [];
  lines.push(`Diagnosis key: \`${finding.key}\``);
  lines.push(`Severity: \`${finding.severity}\``);
  lines.push(`Source: \`${finding.source}\``);
  lines.push('');
  lines.push('## Observation');
  lines.push(finding.detail);
  lines.push('');
  lines.push('## Suggested Actions');
  if (Array.isArray(finding.suggestions) && finding.suggestions.length > 0) {
    for (const suggestion of finding.suggestions.slice(0, 8)) {
      lines.push(`- ${suggestion}`);
    }
  } else {
    lines.push('- Add targeted rerun and debug investigation for this diagnosis.');
  }
  lines.push('');
  lines.push('## Noteworthy Observations');
  const noteworthy = Array.isArray(finding.noteworthyObservations) ? finding.noteworthyObservations : [];
  if (noteworthy.length > 0) {
    for (const observation of noteworthy.slice(0, 8)) {
      lines.push(`- ${observation}`);
    }
  } else {
    lines.push('- None captured in this run.');
  }
  lines.push('');
  lines.push('## Pain Points');
  const painPoints = Array.isArray(finding.painPoints) ? finding.painPoints : [];
  if (painPoints.length > 0) {
    for (const point of painPoints.slice(0, 8)) {
      lines.push(`- ${point}`);
    }
  } else {
    lines.push('- None captured in this run.');
  }
  lines.push('');
  lines.push('## Improvement Ideas');
  const ideas = Array.isArray(finding.improvementIdeas) ? finding.improvementIdeas : [];
  if (ideas.length > 0) {
    for (const idea of ideas.slice(0, 8)) {
      lines.push(`- ${idea}`);
    }
  } else {
    lines.push('- None captured in this run.');
  }
  lines.push('');
  lines.push('## Evidence');
  if (Array.isArray(finding.evidenceLinks) && finding.evidenceLinks.length > 0) {
    for (const link of finding.evidenceLinks) {
      lines.push(`- ${link}`);
    }
  } else {
    lines.push('- No explicit evidence links captured.');
  }
  lines.push('');
  lines.push('## Related Issues');
  for (const number of finding.relatedIssues ?? []) {
    lines.push(`- #${number}`);
  }
  lines.push('');
  lines.push(`[e2e-diagnosis:${finding.key}]`);
  return `${lines.join('\n')}\n`;
}

function findExistingIssueByDiagnosis(repo, diagnosisKey) {
  const search = `[e2e-diagnosis:${diagnosisKey}] state:open`;
  const json = run('gh', [
    'issue',
    'list',
    '--repo',
    repo,
    '--search',
    search,
    '--limit',
    '1',
    '--json',
    'number,title,url',
  ]);
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null;
}

function createIssue(repo, finding) {
  const existing = findExistingIssueByDiagnosis(repo, finding.key);
  if (existing) {
    return {
      action: 'existing',
      key: finding.key,
      number: existing.number,
      url: existing.url,
    };
  }

  const labels = ['enhancement', toPriorityLabel(finding.severity), 'triage/missing-essentials'];
  const args = [
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    buildIssueTitle(finding),
    '--body',
    buildIssueBody(finding),
  ];
  for (const label of labels) {
    args.push('--label', label);
  }
  const url = run('gh', args);
  const match = String(url).match(/\/issues\/(\d+)$/);
  return {
    action: 'created',
    key: finding.key,
    number: match ? Number.parseInt(match[1], 10) : null,
    url,
  };
}

function buildMarkdown(triage) {
  const lines = [];
  lines.push('# E2E Outcome Triage');
  lines.push('');
  lines.push(`- Findings: ${triage.summary.findings}`);
  lines.push(`- Immediate actions: ${triage.summary.immediateActions}`);
  lines.push(`- Issue candidates: ${triage.summary.issueCandidates}`);
  lines.push('');
  lines.push('## Immediate Actions');
  lines.push('');
  if (!triage.immediateActions.length) {
    lines.push('- None');
  } else {
    for (const item of triage.immediateActions) {
      lines.push(`- [${item.severity}] ${item.summary} (\`${item.key}\`)`);
    }
  }
  lines.push('');
  lines.push('## Issue Candidates');
  lines.push('');
  if (!triage.issueCandidates.length) {
    lines.push('- None');
  } else {
    for (const item of triage.issueCandidates) {
      lines.push(`- [${item.severity}] ${item.summary} (\`${item.key}\`)`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function deriveDefaultPlanArtifactPath(triageArtifactPath) {
  const normalized = String(triageArtifactPath ?? '').trim();
  if (!normalized || normalized === DEFAULT_ARTIFACT) {
    return DEFAULT_PLAN_ARTIFACT;
  }
  const directory = path.dirname(normalized);
  const basename = path.basename(normalized);
  if (/\.json$/i.test(basename)) {
    if (basename === 'outcome-triage.json') {
      return path.join(directory, 'agent-issue-fix-plan.json');
    }
    return path.join(directory, basename.replace(/\.json$/i, '.fix-plan.json'));
  }
  return path.join(directory, `${basename}.fix-plan.json`);
}

function deriveDefaultPlanMarkdownPath(planArtifactPath) {
  const normalized = String(planArtifactPath ?? '').trim();
  if (!normalized || normalized === DEFAULT_PLAN_ARTIFACT) {
    return DEFAULT_PLAN_MARKDOWN;
  }
  if (/\.json$/i.test(normalized)) {
    return normalized.replace(/\.json$/i, '.md');
  }
  return `${normalized}.md`;
}

function buildResolutionPlan(triage, issueActions, reportPath, triageArtifactPath) {
  const issueActionMap = new Map();
  for (const action of issueActions) {
    const key = String(action?.key ?? '').trim();
    if (!key || issueActionMap.has(key)) continue;
    issueActionMap.set(key, action);
  }

  const backlog = triage.immediateActions.concat(triage.issueCandidates);
  const queue = backlog
    .map((item) => {
      const key = String(item?.key ?? '').trim();
      const verification = buildVerificationCommands(key);
      const issueAction = issueActionMap.get(key) ?? null;
      return {
        key,
        summary: String(item?.summary ?? ''),
        severity: String(item?.severity ?? 'medium'),
        immediate: item?.immediate === true,
        priority: severityPriority(String(item?.severity ?? 'medium'), item?.immediate === true),
        source: String(item?.source ?? 'unknown'),
        detail: String(item?.detail ?? ''),
        recommendedActions: Array.isArray(item?.suggestions) && item.suggestions.length > 0
          ? item.suggestions.slice(0, 5)
          : ['Run targeted diagnosis and implement root-cause remediation.'],
        verificationCommands: verification,
        relatedIssues: Array.isArray(item?.relatedIssues) ? item.relatedIssues : [],
        issueAction,
      };
    })
    .sort((left, right) => {
      if (left.immediate !== right.immediate) {
        return left.immediate ? -1 : 1;
      }
      return severityRank(left.severity) - severityRank(right.severity);
    })
    .map((item, index) => ({ order: index + 1, ...item }));

  return {
    schema_version: 1,
    kind: 'E2ERemediationPlan.v1',
    createdAt: new Date().toISOString(),
    reportStatus: String(triage.reportStatus ?? 'unknown'),
    source: {
      report: reportPath,
      triageArtifact: triageArtifactPath,
    },
    summary: {
      totalActions: queue.length,
      immediateActions: queue.filter((item) => item.immediate).length,
      backlogActions: queue.filter((item) => !item.immediate).length,
    },
    queue,
  };
}

function buildPlanMarkdown(plan) {
  const lines = [];
  lines.push('# E2E Remediation Plan');
  lines.push('');
  lines.push(`- Report status: ${plan.reportStatus}`);
  lines.push(`- Total actions: ${plan.summary.totalActions}`);
  lines.push(`- Immediate actions: ${plan.summary.immediateActions}`);
  lines.push(`- Backlog actions: ${plan.summary.backlogActions}`);
  lines.push('');
  lines.push('## Execution Queue');
  lines.push('');
  if (!Array.isArray(plan.queue) || plan.queue.length === 0) {
    lines.push('- None');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }
  for (const item of plan.queue) {
    lines.push(`1. [${item.priority}] ${item.summary} (\`${item.key}\`)`);
    lines.push(`   - Severity: ${item.severity}`);
    lines.push(`   - Immediate: ${item.immediate ? 'yes' : 'no'}`);
    lines.push(`   - Source: ${item.source}`);
    lines.push(`   - Action: ${item.recommendedActions[0] ?? 'Run root-cause remediation.'}`);
    lines.push(`   - Verify: ${item.verificationCommands.join(' | ')}`);
    if (item.issueAction && item.issueAction.url) {
      lines.push(`   - Issue: ${item.issueAction.url}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await readJson(options.report);
  const triage = buildTriage(report);

  const created = [];
  const shouldCreateIssues = options.createGhIssues && isGhAvailable(options.repo);
  if (shouldCreateIssues) {
    const issueBacklog = options.includeImmediate
      ? triage.immediateActions.concat(triage.issueCandidates)
      : triage.issueCandidates;
    const candidates = options.maxIssues > 0 ? issueBacklog.slice(0, options.maxIssues) : issueBacklog;
    for (const finding of candidates) {
      created.push(createIssue(options.repo, finding));
    }
  } else {
    const issueBacklog = options.includeImmediate
      ? triage.immediateActions.concat(triage.issueCandidates)
      : triage.issueCandidates;
    const candidates = options.maxIssues > 0 ? issueBacklog.slice(0, options.maxIssues) : issueBacklog;
    for (const finding of candidates) {
      created.push({
        action: 'accepted_pending_creation',
        key: finding.key,
        number: null,
        url: null,
        reason: options.createGhIssues
          ? 'gh_unavailable_or_unauthenticated'
          : 'auto_creation_disabled',
      });
    }
  }

  const payload = {
    ...triage,
    issueActions: created,
  };
  await writeJson(options.artifact, payload);
  await writeMarkdown(options.markdown, buildMarkdown(payload));
  const planArtifactPath = options.planArtifact
    ? String(options.planArtifact)
    : deriveDefaultPlanArtifactPath(options.artifact);
  const planMarkdownPath = options.planMarkdown
    ? String(options.planMarkdown)
    : deriveDefaultPlanMarkdownPath(planArtifactPath);
  const remediationPlan = buildResolutionPlan(payload, created, options.report, options.artifact);
  await writeJson(planArtifactPath, remediationPlan);
  await writeMarkdown(planMarkdownPath, buildPlanMarkdown(remediationPlan));

  const criticalCount = payload.immediateActions.length;
  if (criticalCount > 0) {
    console.error(`[e2e:triage] immediate actions required (${criticalCount})`);
    process.exit(2);
  }

  console.log(
    `[e2e:triage] completed findings=${payload.summary.findings} issueCandidates=${payload.summary.issueCandidates} plan=${planArtifactPath}`
  );
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  main().catch(async (error) => {
    const now = new Date().toISOString();
    const payload = {
      schema_version: 1,
      kind: 'E2EOutcomeTriage.v1',
      createdAt: now,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
    await writeJson(DEFAULT_ARTIFACT, payload).catch(() => {});
    console.error('[e2e:triage] failed');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
