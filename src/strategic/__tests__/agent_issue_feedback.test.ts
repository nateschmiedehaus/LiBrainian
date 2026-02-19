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

  it('orders oldest-to-youngest within the same priority bucket', () => {
    const older = issue({
      number: 101,
      title: 'Heuristic fallback returns identical results for all queries — query intent has no effect',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const newer = issue({
      number: 102,
      title: 'Heuristic fallback returns identical results for all queries — query intent has no effect',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const plan = buildIssueFixPlan([newer, older]);
    expect(plan.queue[0]?.number).toBe(101);
    expect(plan.queue[1]?.number).toBe(102);
    const rank = (priority?: string): number => (priority === 'P0' ? 0 : priority === 'P1' ? 1 : priority === 'P2' ? 2 : 3);
    expect(rank(plan.queue[0]?.priority)).toBeLessThanOrEqual(rank(plan.queue[1]?.priority));
  });

  it('does not boost newer issues over older ones for identical risk', () => {
    const oldScore = computeIssuePriority(issue({
      title: 'Stale lock directory after interrupted --full bootstrap blocks all subsequent runs',
      createdAt: '2024-01-01T00:00:00.000Z',
    }));
    const newScore = computeIssuePriority(issue({
      title: 'Stale lock directory after interrupted --full bootstrap blocks all subsequent runs',
      createdAt: '2026-02-18T00:00:00.000Z',
    }));

    expect(oldScore.score).toBeGreaterThanOrEqual(newScore.score);
  });

  it('keeps foundational bootstrap/query issues ahead of advanced orchestration follow-ons', () => {
    const plan = buildIssueFixPlan([
      issue({
        number: 206,
        title: 'WAVE3 [R5]: Multi-agent index coordination with optimistic locking and change events',
        createdAt: '2026-02-18T15:15:30.000Z',
      }),
      issue({
        number: 53,
        title: 'Fix bootstrap destroying existing MVP index before full index build',
        createdAt: '2026-02-18T12:52:55.000Z',
      }),
      issue({
        number: 47,
        title: 'Proactive MCP context injection: annotate agent tool calls without explicit query',
        createdAt: '2026-02-18T12:52:38.000Z',
      }),
    ]);

    expect(plan.queue[0]?.number).toBe(47);
    expect(plan.queue[1]?.number).toBe(53);
    expect(plan.queue[2]?.number).toBe(206);
    expect(plan.queue[2]?.priority === 'P0' || plan.queue[2]?.priority === 'P1').toBe(false);
  });
});
