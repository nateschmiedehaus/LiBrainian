#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const MILESTONE_ORDER = [
  'M0: Dogfood-Ready',
  'M1: Construction MVP',
  'M2: Agent Integration',
  'M3: Scale & Epistemics',
  'M4: World-Class',
];

const MILESTONE_LABELS = new Map(
  MILESTONE_ORDER.map((title, index) => [title, `m${index}`]),
);

const M0_TITLE = 'M0: Dogfood-Ready';
const M0_EXECUTABLE = new Set([
  716, 872, 888, 889, 905, 906, 907, 908, 909, 910,
  911, 912, 913, 914, 915, 916, 917, 918, 919, 920,
]);
const M0_TRACKING = new Set([850, 852, 883]);
const M0_EXCLUDED = new Set([458]);
const M0_BUNDLES = new Map([
  [906, 'm0:bundle-a'],
  [908, 'm0:bundle-a'],
  [910, 'm0:bundle-a'],
  [912, 'm0:bundle-a'],
  [905, 'm0:bundle-b'],
  [907, 'm0:bundle-b'],
  [909, 'm0:bundle-b'],
  [911, 'm0:bundle-b'],
  [889, 'm0:bundle-b'],
  [888, 'm0:bundle-c'],
  [716, 'm0:bundle-c'],
  [872, 'm0:bundle-d'],
  [913, 'm0:bundle-d'],
  [914, 'm0:bundle-d'],
  [915, 'm0:bundle-d'],
  [916, 'm0:bundle-d'],
  [917, 'm0:bundle-d'],
  [918, 'm0:bundle-d'],
  [919, 'm0:bundle-d'],
  [920, 'm0:bundle-d'],
]);
const M0_BUNDLE_ORDER = ['m0:bundle-a', 'm0:bundle-c', 'm0:bundle-d', 'm0:bundle-b'];
const M0_BUNDLE_METADATA = {
  'm0:bundle-a': {
    color: '0E8A16',
    description: 'M0 Bundle A — daily-use retrieval correctness',
  },
  'm0:bundle-b': {
    color: 'B60205',
    description: 'M0 Bundle B — daily-use reliability and truthful health',
  },
  'm0:bundle-c': {
    color: '1D76DB',
    description: 'M0 Bundle C — freshness and real-repo trust',
  },
  'm0:bundle-d': {
    color: '5319E7',
    description: 'M0 Bundle D — agent adoption surface',
  },
};

function parseRepoFromRemoteUrl(remoteUrl) {
  const trimmed = String(remoteUrl || '').trim();
  if (!trimmed) return null;
  const httpsMatch = trimmed.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return httpsMatch?.[1] || null;
}

function resolveRepo(explicitRepo) {
  if (explicitRepo && explicitRepo.trim()) {
    return explicitRepo.trim();
  }
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (remote.status !== 0) {
    throw new Error('Unable to infer GitHub repo from git remote. Pass --repo owner/name.');
  }
  const parsed = parseRepoFromRemoteUrl(remote.stdout);
  if (!parsed) {
    throw new Error('Could not parse GitHub repo from origin remote. Pass --repo owner/name.');
  }
  return parsed;
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `gh failed with exit ${result.status ?? 'unknown'}`);
  }
  return String(result.stdout || '');
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runLocalGit(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `git failed with exit ${result.status ?? 'unknown'}`);
  }
  return String(result.stdout || '');
}

function fetchIssues(repo, state) {
  const args = [
    'issue',
    'list',
    '-R',
    repo,
    '--state',
    state,
    '--limit',
    '500',
    '--json',
    'number,title,body,url,labels,milestone,createdAt,updatedAt,closedAt',
  ];
  return JSON.parse(runGh(args));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeGitHubOutput(filePath, values) {
  if (!filePath) return;
  ensureDir(filePath);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function normalizeLabels(labels) {
  return Array.isArray(labels)
    ? labels
        .map((label) => (typeof label?.name === 'string' ? label.name.trim() : ''))
        .filter(Boolean)
    : [];
}

function milestoneKey(title) {
  const found = MILESTONE_ORDER.findIndex((value) => value === title);
  return found >= 0 ? `M${found}` : null;
}

function milestoneSortOrder(title) {
  const idx = MILESTONE_ORDER.indexOf(title);
  return idx >= 0 ? idx : 99;
}

function hasLabel(labels, target) {
  return labels.includes(target);
}

function isClaimed(labels) {
  return hasLabel(labels, 'agent:claimed');
}

function isShipBlocking(labels) {
  return hasLabel(labels, 'ship-blocking');
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function normalizeWorktreePath(filePath) {
  return String(filePath || '').replace(/\\/gu, '/').trim();
}

function parseWorktreeEntries(output) {
  return String(output || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('?? ')) {
        return {
          path: normalizeWorktreePath(line.slice(3)),
          status: '??',
          kind: 'untracked',
        };
      }

      const status = line.slice(0, 2);
      const payload = line.length > 3 ? line.slice(3).trim() : '';
      const hasConflict = status.includes('U') || status === 'AA' || status === 'DD';
      if (hasConflict) {
        return {
          path: normalizeWorktreePath(payload),
          status,
          kind: 'conflicted',
        };
      }

      if (status.includes('R') && payload.includes(' -> ')) {
        const [fromPath, toPath] = payload.split(' -> ');
        return {
          path: normalizeWorktreePath(toPath),
          originalPath: normalizeWorktreePath(fromPath),
          status,
          kind: 'renamed',
        };
      }

      if (status.includes('D')) {
        return {
          path: normalizeWorktreePath(payload),
          status,
          kind: 'deleted',
        };
      }

      if (status.includes('A')) {
        return {
          path: normalizeWorktreePath(payload),
          status,
          kind: 'added',
        };
      }

      return {
        path: normalizeWorktreePath(payload),
        status,
        kind: 'modified',
      };
    });
}

function worktreeSeverity(count) {
  if (count <= 0) return 'clean';
  if (count <= 10) return 'light';
  if (count <= 50) return 'moderate';
  if (count <= 200) return 'heavy';
  return 'critical';
}

function summarizeWorktree(entries) {
  const summary = {
    totalDirty: entries.length,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
    severity: worktreeSeverity(entries.length),
  };

  for (const entry of entries) {
    if (entry.kind === 'modified') summary.modified += 1;
    else if (entry.kind === 'added') summary.added += 1;
    else if (entry.kind === 'deleted') summary.deleted += 1;
    else if (entry.kind === 'renamed') summary.renamed += 1;
    else if (entry.kind === 'untracked') summary.untracked += 1;
    else if (entry.kind === 'conflicted') summary.conflicted += 1;
  }

  return summary;
}

function fileContentSignature(filePath) {
  try {
    return sha1(fs.readFileSync(filePath));
  } catch {
    return 'missing';
  }
}

function dirtyEntrySignature(entry, cwd) {
  if (entry.kind === 'untracked' || entry.kind === 'added') {
    return `${entry.kind}:${fileContentSignature(path.join(cwd, entry.path))}`;
  }

  try {
    const diff = runLocalGit(
      ['diff', '--no-ext-diff', '--binary', '--', entry.originalPath || entry.path],
      cwd,
    );
    return `${entry.kind}:${sha1(diff)}`;
  } catch {
    return `${entry.kind}:unavailable`;
  }
}

function captureWorktreeSnapshot(cwd = process.cwd()) {
  let root = cwd;
  try {
    root = runLocalGit(['rev-parse', '--show-toplevel'], cwd).trim() || cwd;
  } catch {
    root = cwd;
  }
  const output = runLocalGit(
    ['status', '--porcelain=1', '--untracked-files=all', '--renames'],
    root,
  );
  const entries = parseWorktreeEntries(output).map((entry) => ({
    ...entry,
    signature: dirtyEntrySignature(entry, root),
  }));
  return {
    kind: 'WorktreeGuardSnapshot.v1',
    root,
    createdAt: new Date().toISOString(),
    entries,
    summary: summarizeWorktree(entries),
  };
}

function compareWorktreeSnapshots(baseline, current) {
  const baselineMap = new Map(
    (baseline.entries || []).map((entry) => [entry.path, entry]),
  );
  const currentMap = new Map(
    (current.entries || []).map((entry) => [entry.path, entry]),
  );

  const newEntries = [];
  const touchedBaselineEntries = [];
  const preservedBaselineEntries = [];
  const resolvedBaselineEntries = [];

  for (const entry of current.entries || []) {
    const prior = baselineMap.get(entry.path);
    if (!prior) {
      newEntries.push(entry);
      continue;
    }

    if (prior.status !== entry.status || prior.signature !== entry.signature) {
      touchedBaselineEntries.push(entry);
    } else {
      preservedBaselineEntries.push(entry);
    }
  }

  for (const entry of baseline.entries || []) {
    if (!currentMap.has(entry.path)) {
      resolvedBaselineEntries.push(entry);
    }
  }

  let guardAction = 'clean';
  if (touchedBaselineEntries.length > 0) {
    guardAction = 'review_overlap';
  } else if (newEntries.length > 0) {
    guardAction = 'agent_delta_only';
  } else if ((current.summary?.totalDirty || 0) > 0) {
    guardAction = 'preserve_foreign_dirty';
  }

  return {
    kind: 'WorktreeGuardDelta.v1',
    createdAt: new Date().toISOString(),
    baseline,
    current,
    delta: {
      newEntries,
      touchedBaselineEntries,
      preservedBaselineEntries,
      resolvedBaselineEntries,
    },
    summary: {
      baselineDirtyCount: baseline.summary?.totalDirty || 0,
      currentDirtyCount: current.summary?.totalDirty || 0,
      newDirtyCount: newEntries.length,
      touchedBaselineCount: touchedBaselineEntries.length,
      preservedBaselineCount: preservedBaselineEntries.length,
      resolvedBaselineCount: resolvedBaselineEntries.length,
      guardAction,
    },
  };
}

function isM0Milestone(title) {
  return title === M0_TITLE;
}

function m0RoleForIssue(number) {
  if (M0_EXECUTABLE.has(number)) return 'executable';
  if (M0_TRACKING.has(number)) return 'tracking';
  if (M0_EXCLUDED.has(number)) return 'excluded';
  return 'unexpected';
}

function m0BundleForIssue(number) {
  return M0_BUNDLES.get(number) || null;
}

function parseSourceIssueNumber(issue) {
  const title = String(issue.title || '');
  const body = String(issue.body || '');
  const patterns = [
    /source issue:\s*#(\d+)/i,
    /source_issue=(\d+)/i,
    /issue\s*#(\d+)/i,
  ];
  for (const pattern of patterns) {
    const titleMatch = title.match(pattern);
    if (titleMatch?.[1]) return Number.parseInt(titleMatch[1], 10);
    const bodyMatch = body.match(pattern);
    if (bodyMatch?.[1]) return Number.parseInt(bodyMatch[1], 10);
  }
  return null;
}

function parseMetaQueue(issue) {
  const title = String(issue.title || '');
  const body = String(issue.body || '');
  const bodyMatch = body.match(/queue=(work|verify)/i);
  if (bodyMatch?.[1]) return bodyMatch[1].toLowerCase();
  if (/^meta:\s*verify/i.test(title)) return 'verify';
  return 'work';
}

function classifyIssue(issue) {
  const labels = normalizeLabels(issue.labels);
  const milestoneTitle = issue.milestone?.title || null;
  if (hasLabel(labels, 'agent:management-ticket')) return 'management-meta';
  if (isM0Milestone(milestoneTitle)) {
    const role = m0RoleForIssue(issue.number);
    if (role === 'tracking' || role === 'unexpected') return 'tracking-or-umbrella';
    if (role === 'excluded') return 'post-ship';
  }
  if (hasLabel(labels, 'kind/tracking')) return 'tracking-or-umbrella';
  if (hasLabel(labels, 'lifecycle/frozen')) return 'frozen-roadmap';
  if (hasLabel(labels, 'post-ship')) return 'post-ship';
  if (hasLabel(labels, 'triage/missing-essentials')) return 'needs-essentials';
  return 'execution-ready';
}

function isExecutableSource(issueClass) {
  return !['management-meta', 'tracking-or-umbrella', 'frozen-roadmap', 'post-ship'].includes(issueClass);
}

function isExecutionReady(issue) {
  return issue.issueClass === 'execution-ready' && !issue.verifyPending && !issue.claimed;
}

function normalizeIssue(issue) {
  const labels = normalizeLabels(issue.labels);
  const milestoneTitle = issue.milestone?.title || null;
  const issueClass = classifyIssue(issue);
  const executableSource = isExecutableSource(issueClass);
  const contradictions = [];
  if (hasLabel(labels, 'triage/ready') && hasLabel(labels, 'triage/missing-essentials')) {
    contradictions.push('contradictory_readiness');
  }
  const milestoneLabel = milestoneTitle ? MILESTONE_LABELS.get(milestoneTitle) || null : null;
  const carriedMilestoneLabels = labels.filter((label) => /^m[0-4]$/i.test(label));
  if (milestoneLabel) {
    const wrongMilestoneLabels = carriedMilestoneLabels.filter((label) => label !== milestoneLabel);
    if (wrongMilestoneLabels.length > 0) {
      contradictions.push('milestone_label_mismatch');
    }
  }
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    milestoneTitle,
    milestoneKey: milestoneKey(milestoneTitle),
    labels,
    updatedAt: issue.updatedAt || null,
    closedAt: issue.closedAt || null,
    issueClass,
    executableSource,
    executionReady: false,
    verifyPending: hasLabel(labels, 'verify:pending'),
    verifyFail: hasLabel(labels, 'verify:fail'),
    managementTicket: hasLabel(labels, 'agent:management-ticket'),
    missingEssentials: hasLabel(labels, 'triage/missing-essentials'),
    needsDecomposition: hasLabel(labels, 'agent:needs-decomposition'),
    claimed: isClaimed(labels),
    shipBlocking: isShipBlocking(labels),
    m0Role: isM0Milestone(milestoneTitle) ? m0RoleForIssue(issue.number) : null,
    m0Bundle: isM0Milestone(milestoneTitle) ? m0BundleForIssue(issue.number) : null,
    unexpectedM0: isM0Milestone(milestoneTitle) && m0RoleForIssue(issue.number) === 'unexpected',
    contradictions,
  };
}

function finalizeNormalizedIssue(issue) {
  return {
    ...issue,
    executionReady: isExecutionReady(issue),
  };
}

function countClosedLast24h(closedIssues, milestoneTitle) {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  return closedIssues.filter((issue) => {
    const normalized = normalizeIssue(issue);
    if (normalized.milestoneTitle !== milestoneTitle) return false;
    if (!normalized.executableSource) return false;
    const closedMs = Date.parse(issue.closedAt || '');
    return Number.isFinite(closedMs) && closedMs >= cutoffMs;
  }).length;
}

function buildLedger(openIssues, closedIssues, repo) {
  const normalized = openIssues.map(normalizeIssue).map(finalizeNormalizedIssue);
  const activeMilestone =
    MILESTONE_ORDER.find((title) => normalized.some((issue) => issue.milestoneTitle === title && issue.executableSource)) ||
    'none';

  const milestones = {};
  for (const title of MILESTONE_ORDER) {
    const issues = normalized.filter((issue) => issue.milestoneTitle === title);
    const total = issues.length;
    const executableSource = issues.filter((issue) => issue.executableSource).length;
    const executionReady = issues.filter((issue) => issue.executionReady).length;
    const management = issues.filter((issue) => issue.issueClass === 'management-meta').length;
    const missingEssentials = issues.filter((issue) => issue.issueClass === 'needs-essentials').length;
    const needsDecomposition = issues.filter((issue) => issue.issueClass === 'needs-decomposition').length;
    const frozen = issues.filter((issue) => issue.issueClass === 'frozen-roadmap').length;
    const tracking = issues.filter((issue) => issue.issueClass === 'tracking-or-umbrella').length;
    const postShip = issues.filter((issue) => issue.issueClass === 'post-ship').length;
    const verifyPending = issues.filter((issue) => issue.verifyPending).length;
    const verifyFail = issues.filter((issue) => issue.verifyFail).length;
    const unexpectedM0 = issues.filter((issue) => issue.unexpectedM0).length;
    const closedSource24h = countClosedLast24h(closedIssues, title);
    const metaBudget = executableSource > 0 ? Math.min(4, Math.max(1, Math.ceil(executableSource / 6))) : 0;
    const metaBudgetExceeded = management > metaBudget;
    milestones[title] = {
      title,
      key: milestoneKey(title),
      sortOrder: milestoneSortOrder(title),
      total,
      executableSource,
      executionReady,
      management,
      missingEssentials,
      needsDecomposition,
      frozen,
      tracking,
      postShip,
      verifyPending,
      verifyFail,
      unexpectedM0,
      closedSource24h,
      metaBudget,
      metaBudgetExceeded,
      sourceStarved: executionReady > 0 && closedSource24h === 0,
      transitionVerdict: executableSource === 0 && verifyPending === 0 && unexpectedM0 === 0 ? 'GO' : 'NO_GO',
      openIssueNumbers: issues.map((issue) => issue.number).sort((a, b) => a - b),
      readyIssueNumbers: issues.filter((issue) => issue.executionReady).map((issue) => issue.number).sort((a, b) => a - b),
    };
    if (title === M0_TITLE) {
      milestones[title].expectedExecutableIssueNumbers = [...M0_EXECUTABLE].sort((a, b) => a - b);
      milestones[title].trackingIssueNumbers = [...M0_TRACKING].sort((a, b) => a - b);
      milestones[title].excludedIssueNumbers = [...M0_EXCLUDED].sort((a, b) => a - b);
      milestones[title].bundlePriority = M0_BUNDLE_ORDER;
      milestones[title].bundleIssueNumbers = Object.fromEntries(
        M0_BUNDLE_ORDER.map((bundle) => [
          bundle,
          issues.filter((issue) => issue.m0Bundle === bundle).map((issue) => issue.number).sort((a, b) => a - b),
        ]),
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    repo,
    activeMilestone,
    totals: {
      openIssues: normalized.length,
      executableSource: normalized.filter((issue) => issue.executableSource).length,
      executionReady: normalized.filter((issue) => issue.executionReady).length,
      management: normalized.filter((issue) => issue.issueClass === 'management-meta').length,
    },
    issues: normalized.sort((a, b) => {
      const milestoneCompare = milestoneSortOrder(a.milestoneTitle) - milestoneSortOrder(b.milestoneTitle);
      if (milestoneCompare !== 0) return milestoneCompare;
      return a.number - b.number;
    }),
    milestones,
  };
}

function bundleRank(issue) {
  if (!issue.m0Bundle) return 99;
  const index = M0_BUNDLE_ORDER.indexOf(issue.m0Bundle);
  return index >= 0 ? index : 99;
}

function chooseWorkIssue(ledger, requestedIssueNumber = null) {
  if (requestedIssueNumber !== null) {
    const issue = ledger.issues.find((candidate) => candidate.number === requestedIssueNumber) || null;
    return issue && issue.executableSource ? issue : null;
  }

  if (ledger.activeMilestone === 'none') return null;

  const candidates = ledger.issues
    .filter((issue) => issue.milestoneTitle === ledger.activeMilestone)
    .filter((issue) => issue.executableSource)
    .filter((issue) => issue.executionReady);

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const shipBlockingDelta = Number(b.shipBlocking) - Number(a.shipBlocking);
    if (shipBlockingDelta !== 0) return shipBlockingDelta;
    if (ledger.activeMilestone === M0_TITLE) {
      const bundleDelta = bundleRank(a) - bundleRank(b);
      if (bundleDelta !== 0) return bundleDelta;
    }
    return a.number - b.number;
  })[0];
}

function chooseVerifyIssue(ledger, requestedIssueNumber = null) {
  if (requestedIssueNumber !== null) {
    const issue = ledger.issues.find((candidate) => candidate.number === requestedIssueNumber) || null;
    return issue && issue.executableSource ? issue : null;
  }

  const inActiveMilestone = ledger.issues
    .filter((issue) => issue.milestoneTitle === ledger.activeMilestone)
    .filter((issue) => issue.executableSource)
    .filter((issue) => issue.verifyPending)
    .sort((a, b) => a.number - b.number);
  if (inActiveMilestone.length > 0) return inActiveMilestone[0];

  const globalCandidates = ledger.issues
    .filter((issue) => issue.executableSource)
    .filter((issue) => issue.verifyPending)
    .sort((a, b) => a.number - b.number);
  return globalCandidates[0] || null;
}

function emitSelection(selection, githubOutputPath, jsonOutput) {
  const outputs = selection
    ? {
        found: true,
        issue_number: selection.number,
        issue_title: selection.title,
        issue_milestone: selection.milestoneTitle || 'none',
        issue_bundle: selection.m0Bundle || '',
        issue_verify_pending: selection.verifyPending,
      }
    : {
        found: false,
        issue_number: '',
        issue_title: '',
        issue_milestone: 'none',
        issue_bundle: '',
        issue_verify_pending: false,
      };

  writeGitHubOutput(githubOutputPath, outputs);

  if (jsonOutput) {
    console.log(JSON.stringify(selection, null, 2));
  } else if (selection) {
    console.log(`selected issue: #${selection.number} ${selection.title}`);
  } else {
    console.log('selected issue: none');
  }
}

function renderMilestoneBrief(content, ledger) {
  const date = ledger.generatedAt.slice(0, 10);
  const executionTruthNote =
    'Execution truth comes from generated ledger artifacts under `state/portfolio/` and `state/milestones/`. This brief is an advisory summary and must be checked against live GitHub issue state and CLI behavior before making product decisions.';
  const snapshotLines = [
    '## Backlog Snapshot',
    '',
    `Generated from live GitHub issue ledger on ${date}.`,
    '',
    `- Total open issues: ${ledger.totals.openIssues}`,
    ...MILESTONE_ORDER.map((title) => {
      const score = ledger.milestones[title];
      return `- ${score.key}: ${score.total} total (${score.executableSource} executable, ${score.executionReady} execution-ready)`;
    }),
    '',
  ].join('\n');

  let next = content.replace(
    /## Backlog Snapshot[\s\S]*?## Execution Policy/,
    `${snapshotLines}\n## Execution Policy`,
  );
  next = next.replace(/Last updated:\s*[0-9-]+/, `Last updated: ${date}`);
  if (!next.includes(executionTruthNote)) {
    next = next.replace(
      /## Execution Policy\n\n/,
      `## Execution Policy\n\n${executionTruthNote}\n\n`,
    );
  }

  for (const title of MILESTONE_ORDER) {
    const score = ledger.milestones[title];
    const pattern = new RegExp(`(## ${escapeRegex(title)}(?: \\(Frozen\\))?\\n\\n)Open issues \\([^\\n]+\\): [^\\n]+\\n`);
    const replacement = `$1Open issues (${date}): ${score.total} total / ${score.executableSource} executable / ${score.executionReady} execution-ready\n`;
    next = next.replace(pattern, replacement);
  }
  return next;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function syncMilestoneBrief(docPath, ledger, writeDocs) {
  if (!docPath) return null;
  const current = fs.readFileSync(docPath, 'utf8');
  const next = renderMilestoneBrief(current, ledger);
  const changed = current !== next;
  if (changed && writeDocs) {
    fs.writeFileSync(docPath, next, 'utf8');
  }
  return { changed, path: docPath };
}

function writeScorecards(scorecardDir, ledger) {
  if (!scorecardDir) return;
  for (const title of MILESTONE_ORDER) {
    const score = ledger.milestones[title];
    const dir = path.join(scorecardDir, score.key || title.replace(/[^A-Za-z0-9]+/g, '-'));
    writeJson(path.join(dir, 'scorecard.json'), score);
  }
}

function ensureLabel(repo, name, color, description) {
  const existing = runGh(['label', 'list', '-R', repo, '--limit', '500', '--json', 'name', '--jq', '.[].name']);
  if (existing.split('\n').map((line) => line.trim()).includes(name)) {
    return;
  }
  runGh(['label', 'create', name, '-R', repo, '--color', color, '--description', description]);
}

function getIssueState(repo, issueNumber) {
  return JSON.parse(runGh(['issue', 'view', String(issueNumber), '-R', repo, '--json', 'state,labels']));
}

function applyRepair(issueNumber, args) {
  if (args.length === 0) return;
  runGh(['issue', 'edit', String(issueNumber), ...args]);
}

function closeIssue(issueNumber, repo, comment) {
  runGh(['issue', 'close', String(issueNumber), '-R', repo, '--comment', comment]);
}

function repairIssues(issues, repo, applyChanges) {
  const summary = {
    contradictoryReadinessFixed: 0,
    milestoneLabelFixed: 0,
    trackingRoleFixed: 0,
    bundleLabelsFixed: 0,
    malformedMetaClosed: 0,
    staleMetaClosed: 0,
    inspected: issues.length,
  };

  if (applyChanges) {
    for (const [label, meta] of Object.entries(M0_BUNDLE_METADATA)) {
      ensureLabel(repo, label, meta.color, meta.description);
    }
  }

  for (const issue of issues) {
    const normalized = normalizeIssue(issue);
    const removeLabels = [];
    const addLabels = [];
    const bundleLabels = Object.keys(M0_BUNDLE_METADATA);

    if (normalized.contradictions.includes('contradictory_readiness')) {
      removeLabels.push('triage/ready');
      summary.contradictoryReadinessFixed += 1;
    }

    if (normalized.milestoneTitle) {
      const expected = MILESTONE_LABELS.get(normalized.milestoneTitle) || null;
      const carried = normalized.labels.filter((label) => /^m[0-4]$/i.test(label));
      const wrong = carried.filter((label) => label !== expected);
      if (expected && (wrong.length > 0 || (carried.length > 0 && !carried.includes(expected)))) {
        removeLabels.push(...wrong);
        if (!carried.includes(expected)) {
          addLabels.push(expected);
        }
        summary.milestoneLabelFixed += 1;
      }
    }

    if (normalized.milestoneTitle === M0_TITLE) {
      if (normalized.m0Role === 'tracking' && !normalized.labels.includes('kind/tracking')) {
        addLabels.push('kind/tracking');
        summary.trackingRoleFixed += 1;
      }

      const expectedBundle = normalized.m0Bundle;
      const carriedBundles = normalized.labels.filter((label) => bundleLabels.includes(label));
      const wrongBundles = expectedBundle
        ? carriedBundles.filter((label) => label !== expectedBundle)
        : carriedBundles;
      if (wrongBundles.length > 0) {
        removeLabels.push(...wrongBundles);
        summary.bundleLabelsFixed += wrongBundles.length;
      }
      if (expectedBundle && !carriedBundles.includes(expectedBundle)) {
        addLabels.push(expectedBundle);
        summary.bundleLabelsFixed += 1;
      }
    }

    if (applyChanges && (removeLabels.length > 0 || addLabels.length > 0)) {
      const editArgs = ['-R', repo];
      for (const label of [...new Set(removeLabels)]) {
        editArgs.push('--remove-label', label);
      }
      for (const label of [...new Set(addLabels)]) {
        editArgs.push('--add-label', label);
      }
      applyRepair(issue.number, editArgs);
    }

    if (!normalized.managementTicket) {
      continue;
    }

    const sourceIssue = parseSourceIssueNumber(issue);
    const queue = parseMetaQueue(issue);
    if (!sourceIssue || sourceIssue === issue.number) {
      summary.malformedMetaClosed += 1;
      if (applyChanges) {
        closeIssue(
          issue.number,
          repo,
          `Auto-closing malformed management ticket: invalid source metadata (${sourceIssue ? `self-reference #${sourceIssue}` : 'missing source issue'}).`,
        );
      }
      continue;
    }

    let sourceState = null;
    try {
      sourceState = getIssueState(repo, sourceIssue);
    } catch {
      summary.staleMetaClosed += 1;
      if (applyChanges) {
        closeIssue(issue.number, repo, `Auto-closing stale management ticket: source issue #${sourceIssue} was not found.`);
      }
      continue;
    }

    const sourceLabels = normalizeLabels(sourceState.labels);
    if (String(sourceState.state || '').toUpperCase() === 'CLOSED') {
      summary.staleMetaClosed += 1;
      if (applyChanges) {
        closeIssue(issue.number, repo, `Auto-closing stale management ticket: source issue #${sourceIssue} is closed.`);
      }
      continue;
    }

    const stillRelevant =
      queue === 'verify'
        ? sourceLabels.includes('verify:pending') || sourceLabels.includes('verify:manual-needed')
        : sourceLabels.includes('agent:management-needed');

    if (!stillRelevant) {
      summary.staleMetaClosed += 1;
      if (applyChanges) {
        closeIssue(issue.number, repo, `Auto-closing stale management ticket: source issue #${sourceIssue} no longer requires ${queue} management.`);
      }
    }
  }

  return summary;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function main() {
  const [command = 'ledger', ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      repo: { type: 'string' },
      issue: { type: 'string' },
      input: { type: 'string' },
      'closed-input': { type: 'string' },
      'baseline-in': { type: 'string' },
      out: { type: 'string' },
      'scorecard-dir': { type: 'string' },
      'github-output': { type: 'string' },
      'docs-sync': { type: 'string' },
      'write-docs': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  if (command === 'worktree') {
    const snapshot = captureWorktreeSnapshot(process.cwd());
    const baseline = values['baseline-in'] ? loadJsonFile(values['baseline-in']) : null;
    const payload = baseline ? compareWorktreeSnapshots(baseline, snapshot) : snapshot;

    if (values.out) {
      writeJson(values.out, payload);
    }

    if (baseline) {
      writeGitHubOutput(values['github-output'], {
        baseline_dirty_count: payload.summary.baselineDirtyCount,
        current_dirty_count: payload.summary.currentDirtyCount,
        new_dirty_count: payload.summary.newDirtyCount,
        touched_baseline_count: payload.summary.touchedBaselineCount,
        preserved_baseline_count: payload.summary.preservedBaselineCount,
        resolved_baseline_count: payload.summary.resolvedBaselineCount,
        dirty_guard_action: payload.summary.guardAction,
        dirty_severity: payload.current.summary?.severity || 'clean',
        eligible_new_paths_json: JSON.stringify(payload.delta.newEntries.map((entry) => entry.path)),
        touched_baseline_paths_json: JSON.stringify(payload.delta.touchedBaselineEntries.map((entry) => entry.path)),
      });
    } else {
      writeGitHubOutput(values['github-output'], {
        dirty_count: payload.summary.totalDirty,
        dirty_severity: payload.summary.severity,
        dirty_paths_json: JSON.stringify(payload.entries.map((entry) => entry.path)),
      });
    }

    if (values.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (baseline) {
      console.log(
        `worktree guard: baseline=${payload.summary.baselineDirtyCount} current=${payload.summary.currentDirtyCount} new=${payload.summary.newDirtyCount} touched_baseline=${payload.summary.touchedBaselineCount} action=${payload.summary.guardAction}`,
      );
    } else {
      console.log(
        `worktree snapshot: dirty=${payload.summary.totalDirty} severity=${payload.summary.severity}`,
      );
    }
    return;
  }

  const repo = resolveRepo(typeof values.repo === 'string' ? values.repo : undefined);
  const openIssues = values.input ? loadJsonFile(values.input) : fetchIssues(repo, 'open');
  const closedIssues = values['closed-input'] ? loadJsonFile(values['closed-input']) : fetchIssues(repo, 'closed');

  if (command === 'repair') {
    const summary = repairIssues(openIssues, repo, parseBoolean(values.apply));
    writeGitHubOutput(values['github-output'], {
      contradictory_readiness_fixed: summary.contradictoryReadinessFixed,
      milestone_label_fixed: summary.milestoneLabelFixed,
      tracking_role_fixed: summary.trackingRoleFixed,
      bundle_labels_fixed: summary.bundleLabelsFixed,
      malformed_meta_closed: summary.malformedMetaClosed,
      stale_meta_closed: summary.staleMetaClosed,
    });
    if (values.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `portfolio repair: inspected=${summary.inspected} contradictory=${summary.contradictoryReadinessFixed} milestone_labels=${summary.milestoneLabelFixed} tracking=${summary.trackingRoleFixed} bundle_labels=${summary.bundleLabelsFixed} malformed_meta=${summary.malformedMetaClosed} stale_meta=${summary.staleMetaClosed}`,
      );
    }
    return;
  }

  const ledger = buildLedger(openIssues, closedIssues, repo);
  if (command === 'select-work') {
    const requestedIssueNumber =
      typeof values.issue === 'string' && values.issue.trim()
        ? Number.parseInt(values.issue, 10)
        : null;
    emitSelection(chooseWorkIssue(ledger, Number.isFinite(requestedIssueNumber) ? requestedIssueNumber : null), values['github-output'], values.json);
    return;
  }

  if (command === 'select-verify') {
    const requestedIssueNumber =
      typeof values.issue === 'string' && values.issue.trim()
        ? Number.parseInt(values.issue, 10)
        : null;
    emitSelection(chooseVerifyIssue(ledger, Number.isFinite(requestedIssueNumber) ? requestedIssueNumber : null), values['github-output'], values.json);
    return;
  }

  if (values.out) {
    writeJson(values.out, ledger);
  }
  writeScorecards(values['scorecard-dir'], ledger);
  const docsSync = syncMilestoneBrief(values['docs-sync'], ledger, parseBoolean(values['write-docs']));

  const activeScore =
    ledger.activeMilestone !== 'none'
      ? ledger.milestones[ledger.activeMilestone]
      : {
          executableSource: 0,
          executionReady: 0,
          closedSource24h: 0,
          sourceStarved: false,
          management: 0,
          metaBudget: 0,
          metaBudgetExceeded: false,
          verifyPending: 0,
          transitionVerdict: 'NO_GO',
        };

  writeGitHubOutput(values['github-output'], {
    active_milestone: ledger.activeMilestone,
    open_source: activeScore.executableSource,
    runnable_source: activeScore.executionReady,
    closed_source_24h: activeScore.closedSource24h,
    source_starved: activeScore.sourceStarved,
    open_meta: activeScore.management,
    meta_budget: activeScore.metaBudget,
    meta_budget_exceeded: activeScore.metaBudgetExceeded,
    verify_pending: activeScore.verifyPending,
    transition_verdict: activeScore.transitionVerdict,
    docs_sync_changed: docsSync?.changed || false,
  });

  if (values.json) {
    console.log(JSON.stringify(ledger, null, 2));
  } else {
    console.log(
      `portfolio ledger: active=${ledger.activeMilestone} open=${ledger.totals.openIssues} executable=${ledger.totals.executableSource} ready=${ledger.totals.executionReady}`,
    );
    if (docsSync) {
      console.log(`docs sync: ${docsSync.path} changed=${docsSync.changed}`);
    }
  }
}

main();
