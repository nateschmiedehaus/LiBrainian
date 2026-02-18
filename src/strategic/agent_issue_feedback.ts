/**
 * @fileoverview Agent issue feedback prioritization.
 *
 * Converts GitHub issue snapshots into an execution-ordered fix queue with
 * explicit priority, area, and rollout wave suggestions.
 */

export type IssuePriority = 'P0' | 'P1' | 'P2' | 'P3';

export type IssueArea =
  | 'core-reliability'
  | 'retrieval-quality'
  | 'agent-experience'
  | 'feedback-loop'
  | 'unknown';

export interface AgentIssueSnapshot {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments: number;
}

export interface IssuePlanItem extends AgentIssueSnapshot {
  area: IssueArea;
  priority: IssuePriority;
  score: number;
  reasons: string[];
  recommendedWave: 1 | 2 | 3 | 4;
  recommendedAction: string;
}

export interface IssuePlanSummary {
  totalIssues: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface IssueFixPlan {
  generatedAt: string;
  summary: IssuePlanSummary;
  queue: IssuePlanItem[];
}

const AREA_RANK: Record<IssueArea, number> = {
  'core-reliability': 0,
  'retrieval-quality': 1,
  'agent-experience': 2,
  'feedback-loop': 3,
  unknown: 4,
};

const PRIORITY_RANK: Record<IssuePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const AREA_BASE_SCORE: Record<IssueArea, number> = {
  'core-reliability': 35,
  'retrieval-quality': 25,
  'agent-experience': 18,
  'feedback-loop': 12,
  unknown: 8,
};

const SCORE_RULES: Array<{ pattern: RegExp; points: number; reason: string }> = [
  { pattern: /fails silently|silent failure|silently/i, points: 40, reason: 'silent failure risk' },
  { pattern: /blocks all|blocked all|hard block|cannot proceed/i, points: 35, reason: 'workflow blocking defect' },
  { pattern: /kills database|data loss|compromised|corrupt|interrupted/i, points: 35, reason: 'data integrity risk' },
  { pattern: /no effect|identical results|query intent has no effect/i, points: 25, reason: 'retrieval unusable for agents' },
  { pattern: /stale lock|database locked|lock/i, points: 20, reason: 'storage lock instability' },
  { pattern: /bootstrap|onboarding|first-time|quickstart/i, points: 12, reason: 'onboarding friction' },
  { pattern: /query|retrieval|synthesis|context/i, points: 10, reason: 'core query-path impact' },
  { pattern: /agent|mcp|feedback command|feedback path/i, points: 10, reason: 'agent workflow impact' },
  { pattern: /ux|design issues|pain points/i, points: 8, reason: 'usability overhead' },
];

function blob(issue: AgentIssueSnapshot): string {
  const labels = issue.labels.join(' ');
  return `${issue.title} ${labels}`.toLowerCase();
}

export function inferIssueArea(issue: AgentIssueSnapshot): IssueArea {
  const text = blob(issue);

  if (/feedback path|feedback command|mcp tool|agent-native feedback/i.test(text)) {
    return 'feedback-loop';
  }

  if (/stale lock|database|bootstrap|compromised|kills database|lock|write(s)? silently|partial failure|interrupted/i.test(text)) {
    return 'core-reliability';
  }

  if (/query|retrieval|heuristic fallback|intent has no effect|synthesis|affectedfiles|context packs/i.test(text)) {
    return 'retrieval-quality';
  }

  if (/ux|onboarding|first-time|pain points|operator session|quality warning/i.test(text)) {
    return 'agent-experience';
  }

  return 'unknown';
}

function inferRecommendedWave(area: IssueArea): 1 | 2 | 3 | 4 {
  switch (area) {
    case 'core-reliability':
      return 1;
    case 'retrieval-quality':
      return 2;
    case 'agent-experience':
      return 3;
    case 'feedback-loop':
      return 4;
    default:
      return 3;
  }
}

function inferRecommendedAction(area: IssueArea): string {
  switch (area) {
    case 'core-reliability':
      return 'Add fail-closed behavior, recovery path, and interruption-safe tests.';
    case 'retrieval-quality':
      return 'Add intent-sensitive query regression tests and tighten ranking/fallback behavior.';
    case 'agent-experience':
      return 'Surface actionable guidance earlier and reduce operator decision overhead.';
    case 'feedback-loop':
      return 'Ship structured feedback intake (CLI + MCP) with traceable issue routing.';
    default:
      return 'Clarify scope, add reproducible test, then assign to the nearest track.';
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function computeIssuePriority(issue: AgentIssueSnapshot): {
  area: IssueArea;
  score: number;
  priority: IssuePriority;
  reasons: string[];
} {
  const area = inferIssueArea(issue);
  const text = blob(issue);

  let score = AREA_BASE_SCORE[area];
  const reasons = new Set<string>();

  for (const rule of SCORE_RULES) {
    if (rule.pattern.test(text)) {
      score += rule.points;
      reasons.add(rule.reason);
    }
  }

  if (issue.comments >= 2) {
    score += 5;
    reasons.add('active issue discussion');
  }

  const createdAtMs = Number.isFinite(Date.parse(issue.createdAt)) ? Date.parse(issue.createdAt) : 0;
  if (createdAtMs > 0) {
    const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
    if (ageDays <= 7) {
      score += 5;
      reasons.add('fresh regression in active scope');
    }
  }

  score = clampScore(score);

  const priority: IssuePriority =
    score >= 80 ? 'P0' :
    score >= 65 ? 'P1' :
    score >= 45 ? 'P2' :
    'P3';

  return {
    area,
    score,
    priority,
    reasons: Array.from(reasons),
  };
}

export function buildIssueFixPlan(issues: AgentIssueSnapshot[]): IssueFixPlan {
  const queue = issues.map((issue) => {
    const scored = computeIssuePriority(issue);

    return {
      ...issue,
      area: scored.area,
      score: scored.score,
      priority: scored.priority,
      reasons: scored.reasons,
      recommendedWave: inferRecommendedWave(scored.area),
      recommendedAction: inferRecommendedAction(scored.area),
    } satisfies IssuePlanItem;
  }).sort((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;

    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;

    const areaDelta = AREA_RANK[a.area] - AREA_RANK[b.area];
    if (areaDelta !== 0) return areaDelta;

    return a.number - b.number;
  });

  const summary: IssuePlanSummary = {
    totalIssues: queue.length,
    p0: queue.filter((item) => item.priority === 'P0').length,
    p1: queue.filter((item) => item.priority === 'P1').length,
    p2: queue.filter((item) => item.priority === 'P2').length,
    p3: queue.filter((item) => item.priority === 'P3').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    queue,
  };
}
