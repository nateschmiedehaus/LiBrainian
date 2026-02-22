#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  buildIssueHygienePlan,
  IssueEnvelope,
  pinSelection,
  POST_SHIP_LABEL,
  SHIP_BLOCKING_LABEL,
  type IssueHygienePlan,
} from '../src/strategic/issue_hygiene.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUMP_PATTERNS = [
  /\bjust\s+(?:checking|follow|ping|following)\b/i,
  /\bbump\b/i,
  /\bre(?:bump|ping)\b/i,
  /\bfollow(?:ing)?\s+up\b/i,
  /\bquick\s+reminder\b/i,
  /\bany\s+updates?\b/i,
  /\bjust\s+a\s+ping\b/i,
  /\bplease\s+update\s+me\b/i,
];
const TRIAGE_MARKER_TOKENS = ['triage', 'missing essentials', 'auto-', 'checklist', 'triage-checklist'];
const NOISE_KEYWORDS = [
  'no signal',
  'no response',
  'no updates',
  'same',
  'same for me',
  'not sure',
  'works for me',
  'i can reproduce',
];

interface GhIssueRaw {
  number: number;
  title?: string;
  body?: string;
  milestone?: {
    title?: string;
  } | null;
  labels?: Array<{ name?: string }>;
  createdAt?: string;
  updatedAt?: string;
  comments?: Array<{
    body?: string;
    createdAt?: string;
    author?: {
      login?: string;
      is_bot?: boolean;
    };
  }> | number;
  id?: string;
  isPinned?: boolean;
  state?: string;
}

interface GhPinnedIssueResponse {
  data?: {
    repository?: {
      pinnedIssues?: {
        nodes?: Array<{
          issue?: {
            number?: number;
          };
        }>;
      };
    };
  };
}

interface IssueActionSummary {
  issue: number;
  actions: string[];
}

interface HygieneActionPlan {
  addLabel: Array<{ issue: number; label: string }>;
  removeLabel: Array<{ issue: number; label: string }>;
  close: Array<{ issue: number; reason: string; comment: string; closeReason?: string }>;
  pin: number[];
  unpin: number[];
}

interface HygieneCliOptions {
  repo: string;
  dryRun: boolean;
  issueNumber?: number;
  pinLimit: number;
  pinnedIssueNumbers: Set<number>;
  missingEssentialsDays: number;
  staleDays: number;
  ignoreBumpComments: boolean;
}

interface GhCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], stdio: 'inherit' | 'pipe' = 'pipe'): GhCommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function requireSuccess(command: string, args: string[], context: string): string {
  const output = run(command, args, 'pipe');
  if (output.status !== 0) {
    const detail = [output.stdout, output.stderr].filter(Boolean).join('\n');
    throw new Error(
      `${context} failed (${command} ${args.join(' ')})${detail ? `\n${detail}` : ''}`
    );
  }
  return output.stdout;
}

function parseJson<T>(command: string, args: string[], context: string): T {
  const output = requireSuccess(command, args, context);
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new Error(`${context} output was not valid JSON${error instanceof Error ? `: ${error.message}` : ''}`);
  }
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function fetchPinnedIssueNumbers(repo: string): Promise<Set<number>> {
  const match = repo.match(/^([^/]+)\/([^/]+)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Could not parse repository owner/name from "${repo}"`);
  }
  const owner = match[1];
  const name = match[2];
  const query = 'query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ pinnedIssues(first:100){ nodes { issue { number } } } }}';
  const raw = parseJson<GhPinnedIssueResponse>(
    'gh',
    [
      'api',
      'graphql',
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
      '-f',
      `query=${query}`,
    ],
    'read pinned issues',
  );
  const nodes = raw?.data?.repository?.pinnedIssues?.nodes ?? [];
  const numbers: number[] = [];
  for (const node of nodes) {
    const candidate = Number(node?.issue?.number);
    if (Number.isFinite(candidate)) {
      numbers.push(candidate);
    }
  }
  return new Set(numbers);
}

function ageDays(value: string, now: Date): number {
  const parsed = parseTimestamp(value);
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (now.getTime() - parsed) / DAY_MS);
}

function ensureGhCli() {
  const auth = run('gh', ['auth', 'status']);
  if (auth.status !== 0) {
    const detail = [auth.stdout, auth.stderr].filter(Boolean).join('\n');
    throw new Error(
      `GitHub CLI is unavailable or unauthenticated${detail ? `: ${detail}` : ''}`
    );
  }
}

function resolveRepo(rawRepo?: string): string {
  if (typeof rawRepo === 'string' && rawRepo.trim().length > 0) {
    return rawRepo.trim();
  }
  const gitRemote = run('git', ['remote', 'get-url', 'origin']);
  if (gitRemote.status !== 0 || !gitRemote.stdout.trim()) {
    throw new Error('Unable to infer repository from git remote. Set --repo explicitly.');
  }
  const url = gitRemote.stdout.trim();
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (!match || !match[1]) {
    throw new Error('Unable to infer repository from git remote URL. Set --repo explicitly.');
  }
  return match[1];
}

function normalizeLabelSet(rawLabels?: Array<{ name?: string }>): string[] {
  return (rawLabels ?? [])
    .map((label) => String(label?.name ?? '').trim())
    .filter((name) => name.length > 0);
}

function parseCommentCount(rawCommentField: unknown): number {
  if (typeof rawCommentField === 'number' && Number.isFinite(rawCommentField)) {
    return Math.max(0, Math.trunc(rawCommentField));
  }
  if (Array.isArray(rawCommentField)) {
    return rawCommentField.length;
  }
  return 0;
}

function normalizeIssues(raw: GhIssueRaw[]): IssueEnvelope[] {
  return raw
    .filter((issue) => issue?.number > 0)
    .map((issue) => ({
      number: issue.number,
      title: String(issue.title ?? '').trim(),
      body: String(issue.body ?? ''),
      milestoneTitle: String(issue.milestone?.title ?? '').trim() || undefined,
      labels: normalizeLabelSet(issue.labels),
      createdAt: String(issue.createdAt ?? new Date().toISOString()),
      updatedAt: String(issue.updatedAt ?? new Date().toISOString()),
      commentCount: parseCommentCount((issue as { comments?: unknown }).comments),
      isPinned: Boolean(issue.isPinned),
    }));
}

function listOpenIssues(repo: string, issueNumber?: number): IssueEnvelope[] {
  if (issueNumber) {
    const issue = parseJson<GhIssueRaw>(
      'gh',
      ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,title,body,milestone,labels,createdAt,updatedAt,comments,id,isPinned,state'],
      `read issue #${issueNumber}`
    );
    if (!issue || String(issue.state).toLowerCase() !== 'open') return [];
    return normalizeIssues([issue]);
  }

  return normalizeIssues(parseJson<GhIssueRaw[]>(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--limit',
      '1000',
      '--json',
      'number,title,body,milestone,labels,createdAt,updatedAt,comments,isPinned',
    ],
    'list open issues',
  ));
}

function ensureLabel(repo: string, name: string, color: string, description: string): void {
  const labels = parseJson<Array<{ name: string }>>(
    'gh',
    ['label', 'list', '--repo', repo, '--json', 'name'],
    `read label list for ${name}`
  );
  const available = new Set(labels.map((label) => String(label.name).trim().toLowerCase()));
  if (available.has(name.toLowerCase())) return;

  const created = run('gh', ['label', 'create', name, '--repo', repo, '--color', color, '--description', description]);
  if (created.status !== 0 && !created.stderr.includes('already exists')) {
    throw new Error(`creating label "${name}" failed: ${created.stderr || created.stdout}`);
  }
}

function execute(action: string, args: string[], dryRun: boolean): boolean {
  if (dryRun) {
    console.log(`[issue-hygiene] dry-run: ${action} ${args.join(' ')}`);
    return true;
  }
  const result = run('gh', args, 'inherit');
  if (result.status !== 0) {
    console.warn(`[issue-hygiene] failed: ${action} ${args.join(' ')} — ${result.stderr || result.stdout}`);
    return false;
  }
  return true;
}

function ensureActionPlan(
  issue: IssueEnvelope,
  issuePlan: IssueHygienePlan,
  runPlan: HygieneActionPlan,
): void {
  const expected = issuePlan.recommendedTaxonomy;
  const hasShip = issuePlan.labelSet.has(SHIP_BLOCKING_LABEL);
  const hasPost = issuePlan.labelSet.has(POST_SHIP_LABEL);
  const currentHasExpected = expected === SHIP_BLOCKING_LABEL ? hasShip : hasPost;
  const currentHasUnexpected = expected === SHIP_BLOCKING_LABEL ? hasPost : hasShip;

  if (!currentHasExpected) {
    runPlan.addLabel.push({ issue: issue.number, label: expected });
  }
  if (currentHasUnexpected) {
    runPlan.removeLabel.push({
      issue: issue.number,
      label: expected === SHIP_BLOCKING_LABEL ? POST_SHIP_LABEL : SHIP_BLOCKING_LABEL,
    });
  }
}

function normalizeText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\u200b/g, '')
    .replace(/[\s`*_<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBotLogin(login: string | undefined): boolean {
  const normalized = String(login ?? '').toLowerCase();
  return normalized === 'github-actions[bot]'
    || normalized === 'github-actions'
    || normalized.endsWith('[bot]');
}

function isMeaningfulComment(body: string | undefined, authorLogin: string | undefined): boolean {
  const normalized = normalizeText(body);
  if (!normalized) return false;
  if (isBotLogin(authorLogin)) return false;
  if (normalized.length < 12) return false;

  if (NOISE_KEYWORDS.some((token) => normalized === token)) return false;
  if (BUMP_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (TRIAGE_MARKER_TOKENS.some((token) => normalized.includes(token))) return false;
  if (/^bump/i.test(normalized)) return false;
  if (/^ping/i.test(normalized)) return false;
  if (/^follow(?:ing)? up$/i.test(normalized)) return false;

  return true;
}

async function fetchIssueComments(repo: string, issueNumber: number): Promise<GhIssueRaw['comments']> {
  const issue = parseJson<GhIssueRaw>(
    'gh',
    ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'comments'],
    `read comments for #${issueNumber}`
  );
  const comments = (issue as { comments?: unknown }).comments;
  return Array.isArray(comments) ? comments : [];
}

function pickLatestTimestamp(values: string[]): string | undefined {
  let latest: string | undefined;
  let latestTs = 0;
  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    if (parsed > latestTs) {
      latestTs = parsed;
      latest = value;
    }
  }
  return latest;
}

async function resolveStaleReferenceDate(
  issue: IssueEnvelope,
  repo: string,
  ignoreBumpComments: boolean,
): Promise<string> {
  if (!ignoreBumpComments) return issue.updatedAt;
  if (issue.commentCount === 0) return issue.updatedAt;

  const comments = await fetchIssueComments(repo, issue.number);
  if (!Array.isArray(comments) || comments.length === 0) return issue.updatedAt;

  const meaningfulTimestamps: string[] = [];
  for (const comment of comments) {
    if (isMeaningfulComment(comment?.body, comment?.author?.login)) {
      if (comment?.createdAt) {
        meaningfulTimestamps.push(String(comment.createdAt));
      }
    }
  }

  if (meaningfulTimestamps.length > 0) {
    return pickLatestTimestamp(meaningfulTimestamps) ?? issue.createdAt;
  }

  return issue.createdAt;
}

function summarizeActions(total: number, plan: HygieneActionPlan): IssueActionSummary[] {
  const byIssue = new Map<number, Set<string>>();
  const record = (issue: number, action: string) => {
    const current = byIssue.get(issue) ?? new Set<string>();
    current.add(action);
    byIssue.set(issue, current);
  };

  for (const item of plan.addLabel) record(item.issue, `add label:${item.label}`);
  for (const item of plan.removeLabel) record(item.issue, `remove label:${item.label}`);
  for (const item of plan.close) record(item.issue, `close:${item.reason}`);
  for (const issueNumber of plan.pin) record(issueNumber, 'pin');
  for (const issueNumber of plan.unpin) record(issueNumber, 'unpin');

  const summaries: IssueActionSummary[] = [];
  for (const [issueNumber, actions] of byIssue.entries()) {
    summaries.push({
      issue: issueNumber,
      actions: Array.from(actions),
    });
  }

  summaries.sort((left, right) => left.issue - right.issue);
  console.log(
    `[issue-hygiene] processed ${total} open issues (${summaries.length} impacted)`
  );
  for (const item of summaries) {
    console.log(`[issue-hygiene] #${item.issue}: ${item.actions.join(', ')}`);
  }
  return summaries;
}

async function buildPlan(
  issues: IssueEnvelope[],
  options: HygieneCliOptions,
): Promise<{ basePlans: IssueHygienePlan[]; actionPlan: HygieneActionPlan }> {
  const now = new Date();
  const issueMap = new Map<number, IssueEnvelope>(issues.map((issue) => [issue.number, issue]));
  const basePlans = issues.map((issue) => buildIssueHygienePlan(issue, {
    now,
    missingEssentialsWindowDays: options.missingEssentialsDays,
    staleWindowDays: options.staleDays,
  }));

  const plan: HygieneActionPlan = {
    addLabel: [],
    removeLabel: [],
    close: [],
    pin: [],
    unpin: [],
  };

  for (const issuePlan of basePlans) {
    const issue = issueMap.get(issuePlan.number);
    if (!issue) continue;

    let closeForMissingEssentials = issuePlan.closeForMissingEssentials;
    let closeForStaleNoActivity = issuePlan.closeForStaleNoActivity;

    if (issuePlan.hasEssentialGap) {
      closeForMissingEssentials = issuePlan.closeForMissingEssentials;
      closeForStaleNoActivity = false;
    } else if (options.ignoreBumpComments) {
      const staleReference = await resolveStaleReferenceDate(issue, options.repo, options.ignoreBumpComments);
      closeForStaleNoActivity = ageDays(staleReference, now) >= options.staleDays;
    } else if (!options.ignoreBumpComments) {
      closeForStaleNoActivity = issuePlan.closeForStaleNoActivity;
    }

    if (issuePlan.recommendedTaxonomy === SHIP_BLOCKING_LABEL || issuePlan.recommendedTaxonomy === POST_SHIP_LABEL) {
      ensureActionPlan(issue, issuePlan, plan);
    }

  }

  const survivingPlans = basePlans.filter((candidate) =>
    !plan.close.some((item) => item.issue === candidate.number)
  );

  const currentPinned = new Set(issues.filter((issue) => issue.isPinned).map((issue) => issue.number));
  for (const issueNumber of options.pinnedIssueNumbers) {
    currentPinned.add(issueNumber);
  }
  const pinTarget = new Set(pinSelection(survivingPlans, options.pinLimit, currentPinned));
  const survivingNumbers = new Set<number>(survivingPlans.map((issue) => issue.number));
  for (const issue of survivingPlans) {
    const issueIsPinned = currentPinned.has(issue.number);
    if (issueIsPinned && !pinTarget.has(issue.number)) {
      plan.unpin.push(issue.number);
    }
    if (!issueIsPinned && pinTarget.has(issue.number)) {
      plan.pin.push(issue.number);
    }
  }
  for (const issueNumber of options.pinnedIssueNumbers) {
    if (!pinTarget.has(issueNumber) && !survivingNumbers.has(issueNumber)) {
      plan.unpin.push(issueNumber);
    }
  }

  const filteredAdd: HygieneActionPlan['addLabel'] = [];
  const addSet = new Set<string>();
  for (const item of plan.addLabel) {
    const key = `${item.issue}|${item.label}`;
    if (addSet.has(key)) continue;
    addSet.add(key);
    filteredAdd.push(item);
  }

  const filteredRemove: HygieneActionPlan['removeLabel'] = [];
  const removeSet = new Set<string>();
  for (const item of plan.removeLabel) {
    const key = `${item.issue}|${item.label}`;
    if (removeSet.has(key)) continue;
    removeSet.add(key);
    filteredRemove.push(item);
  }

  const filteredClose: HygieneActionPlan['close'] = [];
  const closeSet = new Set<number>();
  for (const item of plan.close) {
    if (closeSet.has(item.issue)) continue;
    closeSet.add(item.issue);
    filteredClose.push(item);
  }

  return {
    basePlans,
    actionPlan: {
      addLabel: filteredAdd,
      removeLabel: filteredRemove,
      close: filteredClose,
      pin: Array.from(new Set(plan.pin)),
      unpin: Array.from(new Set(plan.unpin)),
    },
  };
}

function applyPlan(repo: string, plan: HygieneActionPlan, dryRun: boolean): number {
  let failureCount = 0;
  const removeSet = new Set<string>();

  for (const item of plan.removeLabel) {
    const key = `${item.issue}|${item.label}`;
    if (removeSet.has(key)) continue;
    removeSet.add(key);
    const ok = execute('remove label', [
      'issue',
      'edit',
      String(item.issue),
      '--repo',
      repo,
      '--remove-label',
      item.label,
    ], dryRun);
    if (!ok) failureCount += 1;
  }

  const addSet = new Set<string>();
  for (const item of plan.addLabel) {
    const key = `${item.issue}|${item.label}`;
    if (addSet.has(key)) continue;
    addSet.add(key);
    const ok = execute('add label', [
      'issue',
      'edit',
      String(item.issue),
      '--repo',
      repo,
      '--add-label',
      item.label,
    ], dryRun);
    if (!ok) failureCount += 1;
  }

  for (const issue of plan.unpin) {
    const ok = execute('unpin', ['issue', 'unpin', String(issue), '--repo', repo], dryRun);
    if (!ok) failureCount += 1;
  }
  for (const issue of plan.pin) {
    const ok = execute('pin', ['issue', 'pin', String(issue), '--repo', repo], dryRun);
    if (!ok) failureCount += 1;
  }

  return failureCount;
}

function parseIssueNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --issue value "${raw}"`);
  }
  return parsed;
}

function parsePositiveInt(raw: string | undefined, flag: string, allowZero = false): number {
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${flag} value`);
  }
  if ((!allowZero && parsed <= 0) || parsed < 0) {
    throw new Error(`Invalid ${flag} value`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      issue: { type: 'string' },
      'pin-limit': { type: 'string', default: '10' },
      'missing-essentials-days': { type: 'string', default: '14' },
      'stale-days': { type: 'string', default: '90' },
      'ignore-bump-comments': { type: 'boolean', default: true },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (args.values.help) {
    console.log([
      'Usage: node scripts/issue-triage-hygiene.ts --repo owner/name [options]',
      '--issue N                Run on one issue only',
      'Auto-close behavior is intentionally disabled.',
      '--pin-limit 10           Pin top-N ship-blocking issues',
      '--missing-essentials-days 14',
      '--stale-days 90',
      '--ignore-bump-comments    Ignore bump-like comments for staleness decisions (default true)',
      '--dry-run',
    ].join('\n'));
    return;
  }

  ensureGhCli();
  const repo = resolveRepo(typeof args.values.repo === 'string' ? args.values.repo : undefined);
  const issueNumber = parseIssueNumber(typeof args.values.issue === 'string' ? args.values.issue : undefined);
  const dryRun = Boolean(args.values['dry-run']);
  const requestedPinLimit = parsePositiveInt(String(args.values['pin-limit']), 'pin-limit');
  const missingEssentialsDays = parsePositiveInt(String(args.values['missing-essentials-days']), 'missing-essentials-days', true);
  const staleDays = parsePositiveInt(String(args.values['stale-days']), 'stale-days', true);
  const ignoreBumpComments = Boolean(args.values['ignore-bump-comments']);
  const githubPinLimit = 3;
  const pinLimit = Math.min(requestedPinLimit, githubPinLimit);
  if (requestedPinLimit !== pinLimit) {
    console.warn(`[issue-hygiene] requested pin-limit ${requestedPinLimit} exceeds GitHub maximum ${githubPinLimit}; using ${pinLimit}`);
  }
  const pinnedIssueNumbers = await fetchPinnedIssueNumbers(repo);

  const options: HygieneCliOptions = {
    repo,
    dryRun,
    issueNumber,
    pinLimit,
    pinnedIssueNumbers,
    missingEssentialsDays,
    staleDays,
    ignoreBumpComments,
  };

  ensureLabel(repo, SHIP_BLOCKING_LABEL, 'B60205', 'Must be fixed before non-blocking work can proceed.');
  ensureLabel(repo, POST_SHIP_LABEL, '0E8A16', 'Important but deferred item.');

  const openIssues = listOpenIssues(repo, options.issueNumber);
  const { basePlans, actionPlan } = await buildPlan(openIssues, options);
  if (actionPlan.addLabel.length === 0
    && actionPlan.removeLabel.length === 0
    && actionPlan.close.length === 0
    && actionPlan.pin.length === 0
    && actionPlan.unpin.length === 0) {
    console.log(`[issue-hygiene] no corrective actions needed (open issues=${basePlans.length})`);
    return;
  }

  summarizeActions(basePlans.length, actionPlan);
  const failureCount = applyPlan(repo, actionPlan, options.dryRun);
  if (failureCount > 0) {
    throw new Error(`Issue hygiene completed with ${failureCount} failed action(s).`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[issue-hygiene] error: ${message}`);
  process.exitCode = 1;
});
