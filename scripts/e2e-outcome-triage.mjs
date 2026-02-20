#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPORT = 'state/e2e/outcome-report.json';
const DEFAULT_ARTIFACT = 'state/e2e/outcome-triage.json';
const DEFAULT_MARKDOWN = 'state/e2e/outcome-triage.md';
const DEFAULT_MAX_ISSUES = 5;

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
    artifact: DEFAULT_ARTIFACT,
    markdown: DEFAULT_MARKDOWN,
    createGhIssues: false,
    includeImmediate: true,
    repo: process.env.GITHUB_REPOSITORY || '',
    maxIssues: DEFAULT_MAX_ISSUES,
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
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --max-issues value: ${value}`);
      options.maxIssues = parsed;
      i += 1;
      continue;
    }
    if (arg === '--create-gh-issues') {
      options.createGhIssues = true;
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

function buildTriage(report) {
  const failures = Array.isArray(report.failures) ? report.failures : [];
  const diagnoses = Array.isArray(report.diagnoses) ? report.diagnoses : [];
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];

  const findings = failures.map((failure) => {
    const classified = classifyFailure(failure);
    return {
      ...classified,
      source: 'failure',
      detail: String(failure),
      suggestions,
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
    evidenceLinks: [],
    relatedIssues: [564],
  }));

  const merged = dedupeByKey(findings.concat(diagnosisFindings));
  const immediateActions = merged.filter((item) => item.immediate);
  const issueCandidates = merged.filter((item) => !item.immediate);

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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await readJson(options.report);
  const triage = buildTriage(report);

  const created = [];
  if (options.createGhIssues) {
    if (!options.repo) {
      throw new Error('Missing --repo (or GITHUB_REPOSITORY) for --create-gh-issues mode');
    }
    const issueBacklog = options.includeImmediate
      ? triage.immediateActions.concat(triage.issueCandidates)
      : triage.issueCandidates;
    const candidates = issueBacklog.slice(0, options.maxIssues);
    for (const finding of candidates) {
      created.push(createIssue(options.repo, finding));
    }
  }

  const payload = {
    ...triage,
    issueActions: created,
  };
  await writeJson(options.artifact, payload);
  await writeMarkdown(options.markdown, buildMarkdown(payload));

  const criticalCount = payload.immediateActions.length;
  if (criticalCount > 0) {
    console.error(`[e2e:triage] immediate actions required (${criticalCount})`);
    process.exit(2);
  }

  console.log(`[e2e:triage] completed findings=${payload.summary.findings} issueCandidates=${payload.summary.issueCandidates}`);
}

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
