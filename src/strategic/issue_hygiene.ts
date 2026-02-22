/**
 * Issue hygiene classification logic for active-process issue triage.
 */

export const SHIP_BLOCKING_LABEL = 'ship-blocking';
export const POST_SHIP_LABEL = 'post-ship';
export const CAP_ELIGIBLE_LABEL = 'lifecycle/cap-eligible';

const ESSENTIAL_SECTION_ALIASES: Record<string, string[]> = {
  impact: ['impact'],
  repro: [
    'repro evidence',
    'reproduction steps',
    'reproduction',
    'repro',
    'justification',
  ],
  acceptance: ['acceptance criteria'],
};

const POST_SHIP_LABEL_HINTS = new Set<string>([
  'kind/research',
  'kind/tracking',
  'kind/meta',
  'kind/idea',
  'user-impact: request',
  'kind/discussion',
]);
const SHIP_BLOCKING_HINT_LABELS = new Set<string>([
  'kind/bug',
  'priority: critical',
  'priority: high',
  'severity: critical',
  'severity: high',
  'user-impact: blocker',
  'user-impact: degraded',
]);
const RESEARCHY_TITLE_PATTERNS = [
  /research/i,
  /roadmap/i,
  /investigation/i,
  /design/i,
  /proposal/i,
  /exploration/i,
  /wishlist/i,
  /brainstorm/i,
  /vision/i,
  /strategy/i,
];
const BUG_SIGNAL_TITLE_PATTERNS = [
  /fix(es|ing)?\b/i,
  /\b(crash|exception|bug|regression|error|failure|broken|reproduc|panic)\b/i,
];
const CAP_PROTECTED_LABELS = new Set<string>([
  SHIP_BLOCKING_LABEL,
  'priority: critical',
  'priority: high',
  'user-impact: blocker',
  'user-impact: degraded',
  'agent/needs-human',
]);
const CAP_PROTECTED_MILESTONE_PATTERNS = [
  /\bm0\b/i,
  /dogfood-ready/i,
];
const CAP_PROTECTED_TITLE_PATTERNS = [
  /\bdogfood\b/i,
  /\bgate\b/i,
  /\brelease\b/i,
  /\breliability\b/i,
  /\bself[- ]?host/i,
  /\bself[- ]?index/i,
  /\bevaluation\b/i,
  /\bbootstrap\b/i,
];
const CAP_MAX_URGENCY_SCORE = 35;
const CAP_MIN_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssueEnvelope {
  number: number;
  title: string;
  body: string;
  labels: string[];
  milestoneTitle?: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  isPinned?: boolean;
}

export interface IssueHygienePlan {
  number: number;
  title: string;
  labelSet: Set<string>;
  milestoneTitle?: string;
  hasEssentialGap: boolean;
  missingEssentials: string[];
  recommendedTaxonomy: IssueTaxonomy;
  taxonomyReasons: string[];
  hasConflictingTaxonomy: boolean;
  missingTaxonomyLabel: boolean;
  closeForMissingEssentials: boolean;
  closeForStaleNoActivity: boolean;
  ageDays: number;
  urgencyScore: number;
}

export type IssueTaxonomy = typeof SHIP_BLOCKING_LABEL | typeof POST_SHIP_LABEL;

export interface IssueHygieneOptions {
  now?: Date;
  missingEssentialsWindowDays?: number;
  staleWindowDays?: number;
}

export interface IssueCapSelection {
  number: number;
  reason: string;
}

export function normalizeCloseReasonForGh(closeReason: string): string {
  return String(closeReason).trim() === 'not_planned' ? 'not planned' : String(closeReason).trim();
}

export interface IssueHygieneRunConfig {
  pinCount: number;
  openIssueCap: number;
  missingEssentialsWindowDays: number;
  staleWindowDays: number;
}

function normalizeLabel(value: string): string {
  return String(value).trim().toLowerCase();
}

export function normalizeSectionHeading(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIssueLabels(rawLabels: readonly string[]): Set<string> {
  return new Set(rawLabels.map((label) => normalizeLabel(label)));
}

function parseRawBody(rawBody: string): string {
  return String(rawBody ?? '').replace(/\r\n/g, '\n').trim();
}

function getSectionNamesFor(label: string): string[] {
  return ESSENTIAL_SECTION_ALIASES[label] ?? [];
}

export function extractSection(body: string, headingCandidates: string[]): string {
  const normalizedNeedles = new Set(headingCandidates.map(normalizeSectionHeading));
  const lines = parseRawBody(body).split('\n');
  let capturing = false;
  const chunks: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      const normalizedHeading = normalizeSectionHeading(headingMatch[1] ?? '');
      if (capturing) {
        break;
      }
      if (normalizedNeedles.has(normalizedHeading)) {
        capturing = true;
      }
      continue;
    }

    if (!capturing) continue;
    chunks.push(line);
  }

  if (!capturing || chunks.length === 0) {
    return '';
  }

  return chunks
    .join('\n')
    .replace(/^[\s\u200b]+|[\s\u200b]+$/g, '')
    .replace(/^\s*[-\*\+]+\s*$/gm, '')
    .trim();
}

function isPlaceholderLine(value: string): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return true;
  const normalized = text
    .replace(/[`*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const placeholders = new Set([
    'n/a',
    'na',
    'none',
    'no response',
    'todo',
    'tbd',
    'to be done',
    'unknown',
    'not provided',
    'tbd.',
  ]);
  return placeholders.has(normalized);
}

export function getMissingEssentials(body: string): string[] {
  const missing: string[] = [];
  const impact = extractSection(body, getSectionNamesFor('impact'));
  const repro = extractSection(body, getSectionNamesFor('repro'));
  const acceptance = extractSection(body, getSectionNamesFor('acceptance'));

  if (!impact || isPlaceholderLine(impact)) {
    missing.push('Impact');
  }
  if (!repro || isPlaceholderLine(repro)) {
    missing.push('Repro evidence');
  }
  if (!acceptance || isPlaceholderLine(acceptance)) {
    missing.push('Acceptance criteria');
  }
  return missing;
}

function scoreTaxonomySignals(labels: Set<string>, title: string): number {
  let score = 0;
  for (const label of SHIP_BLOCKING_HINT_LABELS) {
    if (labels.has(label)) {
      score += 25;
    }
  }
  for (const label of POST_SHIP_LABEL_HINTS) {
    if (labels.has(label)) {
      score -= 20;
    }
  }

  if (labels.has('kind/feature')) {
    score -= 10;
  }
  if (labels.has('user-impact: request')) {
    score -= 8;
  }
  if (labels.has('user-impact: minor')) {
    score -= 8;
  }
  if (labels.has('severity: medium')) {
    score -= 2;
  }
  if (labels.has('severity: low')) {
    score -= 8;
  }
  if (labels.has('priority: medium')) {
    score -= 6;
  }
  if (labels.has('priority: low')) {
    score -= 10;
  }

  const normalizedTitle = String(title ?? '').trim();
  for (const pattern of RESEARCHY_TITLE_PATTERNS) {
    if (pattern.test(normalizedTitle)) {
      score -= 20;
      break;
    }
  }
  for (const pattern of BUG_SIGNAL_TITLE_PATTERNS) {
    if (pattern.test(normalizedTitle)) {
      score += 18;
      break;
    }
  }
  return score;
}

export function inferTaxonomy(labels: Set<string>, title: string): { taxonomy: IssueTaxonomy; reasons: string[] } {
  const normalizedTitle = String(title ?? '').trim();
  const reasons: string[] = [];
  if (labels.has(SHIP_BLOCKING_LABEL)) {
    reasons.push('has ship-blocking label');
    return { taxonomy: SHIP_BLOCKING_LABEL, reasons };
  }
  if (labels.has(POST_SHIP_LABEL)) {
    reasons.push('has post-ship label');
    return { taxonomy: POST_SHIP_LABEL, reasons };
  }

  let score = scoreTaxonomySignals(labels, normalizedTitle);
  for (const label of SHIP_BLOCKING_HINT_LABELS) {
    if (labels.has(label)) {
      reasons.push(`found ship-blocking hint ${label}`);
    }
  }
  for (const label of POST_SHIP_LABEL_HINTS) {
    if (labels.has(label)) {
      reasons.push(`found post-ship hint ${label}`);
    }
  }

  if (RESEARCHY_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    reasons.push('title suggests exploration / research direction');
  }
  if (BUG_SIGNAL_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    reasons.push('title suggests fault + regression signal');
  }
  if (score >= 25) {
    reasons.push('high-impact or severity signals dominate');
    return { taxonomy: SHIP_BLOCKING_LABEL, reasons };
  }
  reasons.push('classified as post-ship by default taxonomy heuristics');
  return { taxonomy: POST_SHIP_LABEL, reasons };
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function ageDays(updatedAt: string, now: Date): number {
  const parsed = parseTimestamp(updatedAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, (now.getTime() - parsed) / DAY_MS);
}

export function buildIssueHygienePlan(issue: IssueEnvelope, options: IssueHygieneOptions = {}): IssueHygienePlan {
  const now = options.now ?? new Date();
  const missingEssentialsWindowDays = options.missingEssentialsWindowDays ?? 14;
  const staleWindowDays = options.staleWindowDays ?? 90;
  const labels = parseIssueLabels(issue.labels);
  const missingEssentials = getMissingEssentials(issue.body);
  const inferredTaxonomy = inferTaxonomy(labels, issue.title);
  const ageSinceCreation = ageDays(issue.createdAt, now);
  const ageSinceUpdate = ageDays(issue.updatedAt, now);
  const hasShipLabel = labels.has(SHIP_BLOCKING_LABEL);
  const hasPostLabel = labels.has(POST_SHIP_LABEL);
  const hasConflictingTaxonomy = hasShipLabel && hasPostLabel;

  const missingTaxonomyLabel = !hasShipLabel && !hasPostLabel;
  const closeForMissingEssentials = missingEssentials.length > 0 && ageSinceCreation >= missingEssentialsWindowDays;
  const closeForStaleNoActivity = missingEssentials.length === 0
    && issue.commentCount === 0
    && ageSinceUpdate >= staleWindowDays;

  let urgencyScore = 0;
  urgencyScore += inferredTaxonomy.taxonomy === SHIP_BLOCKING_LABEL ? 85 : 40;
  if (labels.has('priority: critical')) urgencyScore += 12;
  if (labels.has('priority: high')) urgencyScore += 8;
  if (labels.has('severity: critical')) urgencyScore += 6;
  if (labels.has('severity: high')) urgencyScore += 4;
  if (labels.has('user-impact: blocker')) urgencyScore += 10;
  if (labels.has('user-impact: degraded')) urgencyScore += 4;
  if (labels.has('user-impact: request')) urgencyScore -= 10;
  if (labels.has('kind/research')) urgencyScore -= 25;
  if (labels.has('kind/tracking')) urgencyScore -= 20;
  if (labels.has('kind/meta')) urgencyScore -= 15;
  if (missingEssentials.length > 0) urgencyScore -= 12;
  if (missingEssentials.length === 0 && issue.commentCount > 0) urgencyScore += 2;
  if (ageSinceCreation > 180) urgencyScore += 3;
  if (issue.commentCount > 0) {
    urgencyScore += Math.min(8, issue.commentCount);
  }
  if (labels.has('severity: low')) urgencyScore -= 8;
  if (labels.has('priority: low')) urgencyScore -= 6;

  urgencyScore = Math.max(0, Math.min(100, urgencyScore));

  return {
    number: issue.number,
    title: issue.title,
    labelSet: labels,
    milestoneTitle: issue.milestoneTitle,
    hasEssentialGap: missingEssentials.length > 0,
    missingEssentials,
    recommendedTaxonomy: inferredTaxonomy.taxonomy,
    taxonomyReasons: inferredTaxonomy.reasons,
    hasConflictingTaxonomy,
    missingTaxonomyLabel,
    closeForMissingEssentials,
    closeForStaleNoActivity,
    ageDays: ageSinceUpdate,
    urgencyScore,
  };
}

function issueSortForCapClosure(
  first: IssueHygienePlan,
  second: IssueHygienePlan,
) {
  if (first.ageDays !== second.ageDays) {
    return first.ageDays < second.ageDays ? 1 : -1;
  }
  if (first.urgencyScore !== second.urgencyScore) {
    return first.urgencyScore - second.urgencyScore;
  }
  return first.number - second.number;
}

function isProtectedFromCapClosure(issue: IssueHygienePlan): boolean {
  for (const label of CAP_PROTECTED_LABELS) {
    if (issue.labelSet.has(label)) return true;
  }

  const title = String(issue.title ?? '').trim();
  if (title.length > 0) {
    for (const pattern of CAP_PROTECTED_TITLE_PATTERNS) {
      if (pattern.test(title)) return true;
    }
  }

  const milestone = String(issue.milestoneTitle ?? '').trim();
  if (milestone.length > 0) {
    for (const pattern of CAP_PROTECTED_MILESTONE_PATTERNS) {
      if (pattern.test(milestone)) return true;
    }
  }

  return false;
}

function isCapEligible(issue: IssueHygienePlan): boolean {
  if (!issue.labelSet.has(CAP_ELIGIBLE_LABEL)) return false;
  if (issue.urgencyScore > CAP_MAX_URGENCY_SCORE) return false;
  if (issue.ageDays < CAP_MIN_AGE_DAYS) return false;
  return true;
}

export function pickCapClosureCandidates(
  issues: IssueHygienePlan[],
  openIssueCap: number,
  currentOpenIssueCount: number,
  alreadyClosingNumbers: Set<number> = new Set(),
): IssueCapSelection[] {
  const openAfterKnownClosures = Math.max(
    0,
    currentOpenIssueCount - new Set(alreadyClosingNumbers).size,
  );
  if (openAfterKnownClosures <= openIssueCap) return [];
  const overage = openAfterKnownClosures - openIssueCap;
  return issues
    .filter((issue) => (
      issue.recommendedTaxonomy === POST_SHIP_LABEL
      && !issue.closeForMissingEssentials
      && !isProtectedFromCapClosure(issue)
      && isCapEligible(issue)
      && !alreadyClosingNumbers.has(issue.number)
    ))
    .sort(issueSortForCapClosure)
    .slice(0, overage)
    .map((issue) => ({
      number: issue.number,
      reason: 'cap_enforcement',
    }));
}

export function pinSelection(issues: IssueHygienePlan[], pinLimit: number, pinnedNumbers: Set<number> = new Set()): number[] {
  return issues
    .filter((issue) => (
      issue.recommendedTaxonomy === SHIP_BLOCKING_LABEL
      && !issue.closeForMissingEssentials
      && !issue.closeForStaleNoActivity
      && !pinnedNumbers.has(issue.number)
    ))
    .sort((left, right) => (
      right.urgencyScore - left.urgencyScore
      || left.ageDays - right.ageDays
      || left.number - right.number
    ))
    .slice(0, pinLimit)
    .map((issue) => issue.number);
}
