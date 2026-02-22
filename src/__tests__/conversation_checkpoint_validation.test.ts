import { describe, expect, it } from 'vitest';

import { validateConversationCheckpoint } from '../evidence/conversation_checkpoint_validation.js';

const PASSING_GATES = {
  tasks: {
    'layer7.performanceBenchmark': {
      status: 'pass',
      verified: true,
    },
    'layer0.typecheck': {
      status: 'pass',
      verified: true,
    },
  },
  summary: {
    layer0: {
      total: 2,
      pass: 2,
    },
  },
};

const BASE_INSIGHTS = `# Conversation Insights

## Checkpoint 2026-02-12
- initial historical checkpoint
`;

function makeCheckpointBlock(overrides: { sha?: string; date?: string; status?: string } = {}): string {
  return `<!-- checkpoint
date: ${overrides.date ?? '2026-02-17T00:00:00Z'}
gates_reconcile_sha: ${overrides.sha ?? '71e28e2e8e1567aeed2036a26e2dc026ea82cb55'}
claimed_status: ${overrides.status ?? 'passed'}
-->`;
}

describe('conversation checkpoint validator', () => {
  it('passes when checkpoint header matches latest reconcile sha and all claimed pass gates are passing', () => {
    const report = validateConversationCheckpoint({
      conversationInsightsMarkdown: [
        BASE_INSIGHTS,
        makeCheckpointBlock({
          date: '2026-02-22T12:00:00Z',
          sha: 'abc1234f0000000000000000000000000000000000',
        }),
      ].join('\n'),
      gatesJson: PASSING_GATES,
      latestReconcileSha: 'abc1234f0000000000000000000000000000000000',
      latestReconcileDate: '2026-02-22T12:00:00Z',
    });

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.checkpoint?.gatesReconcileSha).toBe('abc1234f0000000000000000000000000000000000');
  });

  it('fails when no checkpoint header exists', () => {
    const report = validateConversationCheckpoint({
      conversationInsightsMarkdown: BASE_INSIGHTS,
      gatesJson: PASSING_GATES,
      latestReconcileSha: 'abc',
      latestReconcileDate: '2026-02-22T12:00:00Z',
    });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.code === 'missing_checkpoint_header')).toBe(true);
  });

  it('fails when the checkpoint sha does not match the latest evidence reconcile sha', () => {
    const report = validateConversationCheckpoint({
      conversationInsightsMarkdown: [BASE_INSIGHTS, makeCheckpointBlock({ date: '2026-02-22T12:00:00Z' })].join('\n'),
      gatesJson: PASSING_GATES,
      latestReconcileSha: 'other-sha-000000000000000000000000000000000000000',
      latestReconcileDate: '2026-02-22T12:00:00Z',
    });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.code === 'checkpoint_reconcile_sha_mismatch')).toBe(true);
  });

  it('fails when reconcile date is newer than checkpoint date', () => {
    const report = validateConversationCheckpoint({
      conversationInsightsMarkdown: [BASE_INSIGHTS, makeCheckpointBlock({ date: '2026-02-20T00:00:00Z' })].join('\n'),
      gatesJson: PASSING_GATES,
      latestReconcileSha: '71e28e2e8e1567aeed2036a26e2dc026ea82cb55',
      latestReconcileDate: '2026-02-21T00:00:00Z',
    });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.code === 'checkpoint_stale')).toBe(true);
  });

  it('fails when any claimed-pass gate task is failing', () => {
    const report = validateConversationCheckpoint({
      conversationInsightsMarkdown: [BASE_INSIGHTS, makeCheckpointBlock({ date: '2026-02-22T12:00:00Z' })].join('\n'),
      gatesJson: {
        ...PASSING_GATES,
        tasks: {
          ...PASSING_GATES.tasks,
          'layer7.performanceBenchmark': {
            status: 'fail',
            verified: true,
          },
        },
      },
      latestReconcileSha: '71e28e2e8e1567aeed2036a26e2dc026ea82cb55',
      latestReconcileDate: '2026-02-22T12:00:00Z',
    });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.code === 'checkpoint_gates_failed_layer7.performanceBenchmark')).toBe(true);
  });

  it('fails when a claimed-pass gate task remains verified=false', () => {
    const report = validateConversationCheckpoint({
      conversationInsightsMarkdown: [BASE_INSIGHTS, makeCheckpointBlock({ date: '2026-02-22T12:00:00Z' })].join('\n'),
      gatesJson: {
        ...PASSING_GATES,
        tasks: {
          ...PASSING_GATES.tasks,
          'layer7.performanceBenchmark': {
            status: 'pass',
            verified: false,
          },
        },
      },
      latestReconcileSha: '71e28e2e8e1567aeed2036a26e2dc026ea82cb55',
      latestReconcileDate: '2026-02-22T12:00:00Z',
    });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.code === 'checkpoint_gates_failed_layer7.performanceBenchmark')).toBe(true);
  });
});
