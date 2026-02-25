import { describe, expect, it, vi } from 'vitest';
import { deterministic, type ConfidenceValue } from '../../epistemics/confidence.js';
import type { EvidenceId } from '../../epistemics/evidence_ledger.js';
import { ConstructionError } from '../base/construction_base.js';
import { pauseForHuman } from '../operators.js';
import { ok, type Construction, type ConstructionResult, type Context } from '../types.js';

type ReviewValue = ConstructionResult<{ recommendation: string }>;

type TestDeps = {
  librarian: { name: string };
  evidenceLedger?: {
    append: (entry: Record<string, unknown>) => Promise<unknown>;
  };
};

function makeContext(append?: (entry: Record<string, unknown>) => Promise<unknown>): Context<TestDeps> {
  return {
    deps: {
      librarian: { name: 'test-librarian' },
      ...(append ? { evidenceLedger: { append } } : {}),
    },
    signal: new AbortController().signal,
    sessionId: 'sess-test',
  };
}

function makeLowConfidenceResult(evidenceRefs: EvidenceId[]): ReviewValue {
  const confidence: ConfidenceValue = {
    type: 'derived',
    value: 0.42,
    formula: 'test_low_confidence',
    inputs: [],
  };
  return {
    value: { recommendation: 'ask human' },
    confidence,
    evidenceRefs,
    analysisTimeMs: 12,
  };
}

describe('pauseForHuman operator', () => {
  it('returns paused handle under confidence threshold and appends escalation request', async () => {
    const initialEvidence = ['ev_before_pause' as EvidenceId];
    const executeSpy = vi.fn(async () => ok<ReviewValue, ConstructionError>(makeLowConfidenceResult(initialEvidence)));
    const appendSpy = vi.fn(async () => ({ id: 'ev_escalation' }));

    const inner: Construction<string, ReviewValue, ConstructionError, TestDeps> = {
      id: 'inner-review',
      name: 'Inner Review',
      execute: executeSpy,
    };

    const resumable = pauseForHuman(
      inner,
      (_partial, _confidence) => ({
        sessionId: 'sess-test',
        constructionId: 'inner-review',
        question: 'Should this change be approved?',
        context: 'Low confidence on risky path',
        evidenceRefs: initialEvidence,
      }),
      { confidenceThreshold: 0.6 },
    );

    const handle = await resumable.start('input', makeContext(appendSpy));

    expect(handle.status).toBe('paused');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: 'escalation_request',
    });

    if (handle.status === 'paused') {
      expect(handle.request.question).toContain('approved');
      expect(handle.partialEvidence).toEqual(initialEvidence);
    }
  });

  it('resume completes without re-executing inner and preserves evidence refs', async () => {
    const initialEvidence = ['ev_partial_1' as EvidenceId, 'ev_partial_2' as EvidenceId];
    const executeSpy = vi.fn(async () => ok<ReviewValue, ConstructionError>(makeLowConfidenceResult(initialEvidence)));

    let appendCount = 0;
    const appendSpy = vi.fn(async () => {
      appendCount += 1;
      return { id: appendCount === 1 ? 'ev_escalation' : 'ev_override' };
    });

    const inner: Construction<string, ReviewValue, ConstructionError, TestDeps> = {
      id: 'inner-review',
      name: 'Inner Review',
      execute: executeSpy,
      getEstimatedConfidence: () => deterministic(true, 'unused_estimate'),
    };

    const resumable = pauseForHuman(
      inner,
      (_partial, _confidence) => ({
        sessionId: 'sess-test',
        constructionId: 'inner-review',
        question: 'Need human judgment',
        context: 'Escalating due to low confidence',
        evidenceRefs: initialEvidence,
      }),
      { confidenceThreshold: 0.7 },
    );

    const started = await resumable.start('input', makeContext(appendSpy));
    expect(started.status).toBe('paused');
    if (started.status !== 'paused') {
      throw new Error('Expected paused handle for low confidence');
    }

    const resumed = await started.resume({
      reviewerId: 'reviewer-1',
      decision: 'approve_with_notes',
      rationale: 'Manually verified high-risk cases',
      overrideConfidence: 0.91,
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(appendSpy.mock.calls[1]?.[0]).toMatchObject({
      kind: 'human_override',
    });

    expect(resumed.status).toBe('completed');
    if (resumed.status === 'completed') {
      expect(resumed.result.ok).toBe(true);
      if (resumed.result.ok) {
        expect(resumed.result.value.evidenceRefs).toEqual(
          expect.arrayContaining([
            'ev_partial_1',
            'ev_partial_2',
            'ev_escalation',
            'ev_override',
          ]),
        );
        expect(resumed.result.value.confidence.value).toBeCloseTo(0.91, 5);
      }
    }
  });

  it('completes directly when confidence is above threshold', async () => {
    const highConfidenceResult: ReviewValue = {
      value: { recommendation: 'safe_to_proceed' },
      confidence: deterministic(true, 'high_confidence_path'),
      evidenceRefs: ['ev_high' as EvidenceId],
      analysisTimeMs: 5,
    };

    const executeSpy = vi.fn(async () => ok<ReviewValue, ConstructionError>(highConfidenceResult));
    const appendSpy = vi.fn(async () => ({ id: 'ev_unused' }));

    const inner: Construction<string, ReviewValue, ConstructionError, TestDeps> = {
      id: 'inner-high',
      name: 'Inner High Confidence',
      execute: executeSpy,
    };

    const resumable = pauseForHuman(
      inner,
      (_partial, _confidence) => ({
        sessionId: 'sess-test',
        constructionId: 'inner-high',
        question: 'Should not be asked',
        context: 'Should not pause',
        evidenceRefs: ['ev_high' as EvidenceId],
      }),
      { confidenceThreshold: 0.6 },
    );

    const handle = await resumable.start('input', makeContext(appendSpy));

    expect(handle.status).toBe('completed');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('emits human_request stream event and resumes to completed without re-running inner', async () => {
    const initialEvidence = ['ev_stream_partial' as EvidenceId];
    const executeSpy = vi.fn(async () => ok<ReviewValue, ConstructionError>(makeLowConfidenceResult(initialEvidence)));
    const appendSpy = vi.fn(async (entry: Record<string, unknown>) => {
      const kind = typeof entry.kind === 'string' ? entry.kind : 'unknown';
      return { id: kind === 'escalation_request' ? 'ev_stream_escalation' : 'ev_stream_override' };
    });

    const inner: Construction<string, ReviewValue, ConstructionError, TestDeps> = {
      id: 'inner-stream',
      name: 'Inner Stream',
      execute: executeSpy,
    };

    const resumable = pauseForHuman(
      inner,
      (_partial, _confidence) => ({
        sessionId: 'sess-test',
        constructionId: 'inner-stream',
        question: 'Need live reviewer decision',
        context: 'Stream-level escalation',
        evidenceRefs: initialEvidence,
      }),
      { confidenceThreshold: 0.6, timeoutMs: 30_000 },
    );

    const streamEvents: string[] = [];
    for await (const event of resumable.stream!('input', makeContext(appendSpy))) {
      streamEvents.push(event.kind);
      if (event.kind === 'human_request') {
        expect(event.type).toBe('human_request');
        expect(event.timeoutMs).toBe(30_000);
        for await (const resumedEvent of event.continuation.resume({
          reviewerId: 'reviewer-stream',
          decision: 'approve',
          rationale: 'Verified in stream',
        })) {
          streamEvents.push(resumedEvent.kind);
        }
      }
    }

    expect(streamEvents).toEqual(['human_request', 'completed']);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});
