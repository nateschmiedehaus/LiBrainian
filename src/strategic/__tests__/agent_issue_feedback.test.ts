import { describe, expect, it } from 'vitest';
import {
  inferIssueArea,
  computeIssuePriority,
  buildIssueFixPlan,
  type AgentIssueSnapshot,
} from '../agent_issue_feedback.js';

function issue(overrides: Partial<AgentIssueSnapshot>): AgentIssueSnapshot {
  return {
    number: 0,
    title: 'placeholder',
    url: 'https://example.com/issue',
    createdAt: '2026-02-18T00:00:00.000Z',
    updatedAt: '2026-02-18T00:00:00.000Z',
    labels: [],
    comments: 0,
    ...overrides,
  };
}

describe('agent issue feedback planning', () => {
  it('classifies issue area from title keywords', () => {
    expect(
      inferIssueArea(issue({
        title: 'Stale lock directory after interrupted --full bootstrap blocks all subsequent runs',
      })),
    ).toBe('core-reliability');

    expect(
      inferIssueArea(issue({
        title: 'Heuristic fallback returns identical results for all queries — query intent has no effect',
      })),
    ).toBe('retrieval-quality');

    expect(
      inferIssueArea(issue({
        title: 'Add agent-native feedback path: librainian feedback command + MCP tool',
      })),
    ).toBe('feedback-loop');
  });

  it('prioritizes silent-failure reliability defects as P0', () => {
    const scored = computeIssuePriority(
      issue({
        number: 11,
        title: "LLM synthesis fails silently on every query — 'Claude CLI error' buried in Coverage Gaps",
      }),
    );

    expect(scored.priority).toBe('P0');
    expect(scored.score).toBeGreaterThanOrEqual(80);
    expect(scored.reasons.some((reason) => reason.includes('silent'))).toBe(true);
  });

  it('orders fix queue by priority score and area criticality', () => {
    const plan = buildIssueFixPlan([
      issue({
        number: 13,
        title: 'Add agent-native feedback path: librainian feedback command + MCP tool',
      }),
      issue({
        number: 2,
        title: 'Stale lock directory after interrupted --full bootstrap blocks all subsequent runs',
      }),
      issue({
        number: 12,
        title: 'Heuristic fallback returns identical results for all queries — query intent has no effect',
      }),
    ]);

    expect(plan.summary.totalIssues).toBe(3);
    expect(plan.queue[0]?.number).toBe(2);
    expect(plan.queue[0]?.priority).toBe('P0');
    expect(plan.queue[1]?.number).toBe(12);
    expect(plan.queue[2]?.number).toBe(13);
  });
});
