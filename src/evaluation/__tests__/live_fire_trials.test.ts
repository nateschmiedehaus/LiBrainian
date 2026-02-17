import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLiveFireTrials } from '../live_fire_trials.js';

vi.mock('../agentic_journey.js', () => ({
  runAgenticJourney: vi.fn(),
}));

vi.mock('../external_repo_smoke.js', () => ({
  runExternalRepoSmoke: vi.fn(),
}));

import { runAgenticJourney } from '../agentic_journey.js';
import { runExternalRepoSmoke } from '../external_repo_smoke.js';

describe('runLiveFireTrials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runAgenticJourney).mockResolvedValue({
      results: [
        {
          repo: 'repo-a',
          protocol: 'objective',
          overviewOk: true,
          moduleOk: true,
          onboardingOk: true,
          fileContextOk: true,
          glanceOk: false,
          recommendations: 0,
          journeyOk: true,
          steps: [],
          errors: [],
          contextSelection: 'retrieved',
          contextFile: 'README.md',
        },
      ],
    } as any);
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [
        { repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] },
      ],
    });
  });

  it('runs configured rounds and llm mode matrix', async () => {
    const report = await runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 2,
      llmModes: ['disabled', 'optional'],
      includeSmoke: true,
    });

    expect(runAgenticJourney).toHaveBeenCalledTimes(4);
    expect(runExternalRepoSmoke).toHaveBeenCalledTimes(4);
    expect(report.runs).toHaveLength(4);
    expect(report.aggregate.totalRuns).toBe(4);
    expect(report.gates.passed).toBe(true);
    expect(report.gates.classifiedReasons).toHaveLength(0);
    expect(report.gates.severityCounts.blocking).toBe(0);
  });

  it('fails gate when retrieved context rate is below threshold', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({
      results: [
        {
          repo: 'repo-a',
          protocol: 'objective',
          overviewOk: true,
          moduleOk: true,
          onboardingOk: true,
          fileContextOk: false,
          glanceOk: true,
          recommendations: 0,
          journeyOk: true,
          steps: [],
          errors: [],
          contextSelection: 'fallback',
        },
      ],
    } as any);

    const report = await runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: false,
      minRetrievedContextRate: 1,
    });

    expect(report.gates.passed).toBe(false);
    expect(report.gates.reasons.some((reason) => reason.includes('retrieved_context_rate'))).toBe(true);
  });

  it('surfaces provider and validation prerequisite failures in gate reasons', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({
      results: [
        {
          repo: 'repo-a',
          protocol: 'objective',
          overviewOk: true,
          moduleOk: true,
          onboardingOk: true,
          fileContextOk: true,
          glanceOk: false,
          recommendations: 0,
          validation: { blocking: true, violations: 1, warnings: 0 },
          journeyOk: false,
          steps: [],
          errors: [
            'unverified_by_trace(provider_unavailable): journey prerequisites unavailable',
            'unverified_by_trace(validation_unavailable): constraint validation storage unavailable',
          ],
          contextSelection: 'retrieved',
          contextFile: 'README.md',
        },
      ],
    } as any);

    const report = await runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: false,
    });

    expect(report.runs[0]?.reasons).toContain('provider_prerequisite_failures:1');
    expect(report.runs[0]?.reasons).toContain('validation_prerequisite_failures:1');
    expect(report.gates.reasons).toContain('provider_prerequisite_failures_detected');
    expect(report.gates.reasons).toContain('validation_prerequisite_failures_detected');
    expect(report.gates.classifiedReasons.some((entry) => entry.category === 'dependency')).toBe(true);
    expect(report.gates.severityCounts.dependency).toBeGreaterThan(0);
  });

  it('fails closed when journey execution exceeds timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(runAgenticJourney).mockImplementation(() => new Promise(() => {}));

    const reportPromise = runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: false,
      journeyTimeoutMs: 5,
    });

    await vi.advanceTimersByTimeAsync(10);
    const report = await reportPromise;

    expect(report.runs[0]?.reasons.some((reason) => reason.startsWith('journey_execution_failed:'))).toBe(true);
    expect(report.gates.reasons).toContain('journey_execution_failures_detected');
    expect(report.gates.passed).toBe(false);
    vi.useRealTimers();
  });

  it('skips smoke when journey execution times out', async () => {
    vi.useFakeTimers();
    vi.mocked(runAgenticJourney).mockImplementation(() => new Promise(() => {}));

    const reportPromise = runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: true,
      journeyTimeoutMs: 5,
      smokeTimeoutMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(10);
    const report = await reportPromise;

    expect(runExternalRepoSmoke).not.toHaveBeenCalled();
    expect(report.runs[0]?.reasons).toContain('smoke_skipped_due_journey_execution_failure');
    expect(report.runs[0]?.smoke?.failures).toBe(1);
    expect(report.gates.classifiedReasons.some((entry) => entry.category === 'execution')).toBe(true);
    vi.useRealTimers();
  });

  it('passes artifact roots to journey and smoke runners when configured', async () => {
    await runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: true,
      artifactRoot: '/tmp/live-fire-artifacts',
    });

    expect(runAgenticJourney).toHaveBeenCalledWith(expect.objectContaining({
      artifactRoot: '/tmp/live-fire-artifacts/round-1/llm-disabled/journey',
    }));
    expect(runExternalRepoSmoke).toHaveBeenCalledWith(expect.objectContaining({
      artifactRoot: '/tmp/live-fire-artifacts/round-1/llm-disabled/smoke',
    }));
  });

  it('fails closed when artifact evidence is incomplete', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({
      results: [
        {
          repo: 'repo-a',
          protocol: 'objective',
          overviewOk: true,
          moduleOk: true,
          onboardingOk: true,
          fileContextOk: true,
          glanceOk: false,
          recommendations: 0,
          journeyOk: true,
          steps: [],
          errors: [],
          contextSelection: 'retrieved',
          contextFile: 'README.md',
        },
      ],
      artifacts: {
        root: '/tmp/live-fire-artifacts/round-1/llm-disabled/journey',
        reportPath: '/tmp/live-fire-artifacts/round-1/llm-disabled/journey/report.json',
        repoReportPaths: [],
      },
    } as any);
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [
        { repo: 'repo-a', overviewOk: true, contextOk: true, errors: [] },
      ],
      artifacts: {
        root: '/tmp/live-fire-artifacts/round-1/llm-disabled/smoke',
        reportPath: '/tmp/live-fire-artifacts/round-1/llm-disabled/smoke/report.json',
        repoReportPaths: [],
      },
    } as any);

    const report = await runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: true,
      artifactRoot: '/tmp/live-fire-artifacts',
    });

    expect(report.gates.passed).toBe(false);
    expect(report.runs[0]?.reasons).toContain('journey_artifacts_incomplete');
    expect(report.runs[0]?.reasons).toContain('smoke_artifacts_incomplete');
    expect(report.gates.reasons).toContain('journey_artifact_integrity_failures_detected');
    expect(report.gates.reasons).toContain('smoke_artifact_integrity_failures_detected');
  });

  it('passes abort signals to journey and smoke runners', async () => {
    await runLiveFireTrials({
      reposRoot: '/tmp/repos',
      rounds: 1,
      llmModes: ['disabled'],
      includeSmoke: true,
      journeyTimeoutMs: 1000,
      smokeTimeoutMs: 1000,
    });

    const journeyArg = vi.mocked(runAgenticJourney).mock.calls[0]?.[0] as { signal?: AbortSignal } | undefined;
    const smokeArg = vi.mocked(runExternalRepoSmoke).mock.calls[0]?.[0] as { signal?: AbortSignal } | undefined;

    expect(journeyArg?.signal).toBeInstanceOf(AbortSignal);
    expect(smokeArg?.signal).toBeInstanceOf(AbortSignal);
  });
});
