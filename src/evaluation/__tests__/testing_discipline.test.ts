import { describe, expect, it } from 'vitest';
import { evaluateTestingDiscipline } from '../testing_discipline.js';

describe('evaluateTestingDiscipline', () => {
  it('passes for a clean release-evidence bundle', () => {
    const report = evaluateTestingDiscipline({
      useCaseReport: {
        schema: 'AgenticUseCaseReviewReport.v1',
        options: {
          reposRoot: '/tmp/external-repos',
          selectionMode: 'balanced',
          evidenceProfile: 'release',
        },
        summary: {
          uniqueRepos: 6,
          passRate: 0.9,
          evidenceRate: 0.95,
          usefulSummaryRate: 0.9,
          strictFailureShare: 0,
          progression: {
            enabled: true,
            prerequisitePassRate: 0.9,
            targetPassRate: 0.9,
            targetDependencyReadyShare: 1,
          },
        },
      },
      liveFireReport: {
        schema: 'LiveFireTrialReport.v1',
        gates: { passed: true },
        aggregate: { totalRuns: 2 },
        options: {
          reposRoot: '/tmp/external-repos',
          llmModes: ['disabled', 'optional'],
          protocol: 'objective',
          strictObjective: true,
          includeSmoke: true,
        },
      },
      externalSmokeReport: {
        schema: 'ExternalRepoSmokeRunArtifact.v1',
        options: { reposRoot: '/tmp/external-repos' },
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'a', language: 'typescript', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'b', language: 'python', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'c', language: 'go', overviewOk: true, contextOk: true, errors: [] },
        ],
      },
      constructableSamples: [
        { repo: 'a', primaryLanguage: 'typescript', enabledConstructables: ['x'] },
        { repo: 'b', primaryLanguage: 'python', enabledConstructables: ['y'] },
        { repo: 'c', primaryLanguage: 'go', enabledConstructables: ['z'] },
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.summary.failedBlockingChecks).toBe(0);
    expect(report.summary.warningChecks).toBe(0);
    expect(report.checks).toHaveLength(8);
  });

  it('fails when release artifacts contain strict markers', () => {
    const report = evaluateTestingDiscipline({
      useCaseReport: {
        schema: 'AgenticUseCaseReviewReport.v1',
        options: {
          reposRoot: '/tmp/external-repos',
          selectionMode: 'balanced',
          evidenceProfile: 'release',
        },
        summary: {
          uniqueRepos: 6,
          passRate: 0.9,
          evidenceRate: 0.95,
          usefulSummaryRate: 0.9,
          strictFailureShare: 0,
          progression: {
            enabled: true,
            prerequisitePassRate: 0.9,
            targetPassRate: 0.9,
            targetDependencyReadyShare: 1,
          },
        },
        notes: 'fallback_to_brute_force',
      },
      liveFireReport: {
        schema: 'LiveFireTrialReport.v1',
        gates: { passed: true },
        aggregate: { totalRuns: 2 },
        options: {
          reposRoot: '/tmp/external-repos',
          llmModes: ['optional'],
          protocol: 'objective',
          strictObjective: true,
          includeSmoke: true,
        },
      },
      externalSmokeReport: {
        schema: 'ExternalRepoSmokeRunArtifact.v1',
        options: { reposRoot: '/tmp/external-repos' },
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'a', language: 'typescript', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'b', language: 'python', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'c', language: 'go', overviewOk: true, contextOk: true, errors: [] },
        ],
      },
      constructableSamples: [
        { repo: 'a', primaryLanguage: 'typescript', enabledConstructables: ['x'] },
        { repo: 'b', primaryLanguage: 'python', enabledConstructables: ['y'] },
        { repo: 'c', primaryLanguage: 'go', enabledConstructables: ['z'] },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'td_05_release_artifacts_have_no_strict_markers')?.passed).toBe(false);
  });

  it('does not treat benign narrative strings as strict markers', () => {
    const report = evaluateTestingDiscipline({
      useCaseReport: {
        schema: 'AgenticUseCaseReviewReport.v1',
        options: {
          reposRoot: '/tmp/external-repos',
          selectionMode: 'balanced',
          evidenceProfile: 'release',
        },
        summary: {
          uniqueRepos: 6,
          passRate: 0.9,
          evidenceRate: 0.95,
          usefulSummaryRate: 0.9,
          strictFailureShare: 0,
          progression: {
            enabled: true,
            prerequisitePassRate: 0.9,
            targetPassRate: 0.9,
            targetDependencyReadyShare: 1,
          },
        },
        prompts: [
          { need: 'Explain error handling strategy' },
          { need: 'Clarify failure modes and fallbacks' },
        ],
        runs: [
          { strictSignals: [], errors: [] },
        ],
      },
      liveFireReport: {
        schema: 'LiveFireTrialReport.v1',
        gates: { passed: true },
        aggregate: { totalRuns: 2 },
        options: {
          reposRoot: '/tmp/external-repos',
          llmModes: ['disabled', 'optional'],
          protocol: 'objective',
          strictObjective: true,
          includeSmoke: true,
        },
      },
      externalSmokeReport: {
        schema: 'ExternalRepoSmokeRunArtifact.v1',
        options: { reposRoot: '/tmp/external-repos' },
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'a', language: 'typescript', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'b', language: 'python', overviewOk: true, contextOk: true, errors: [] },
          { repo: 'c', language: 'go', overviewOk: true, contextOk: true, errors: [] },
        ],
      },
      constructableSamples: [
        { repo: 'a', primaryLanguage: 'typescript', enabledConstructables: ['x'] },
        { repo: 'b', primaryLanguage: 'python', enabledConstructables: ['y'] },
        { repo: 'c', primaryLanguage: 'go', enabledConstructables: ['z'] },
      ],
    });

    expect(report.checks.find((check) => check.id === 'td_05_release_artifacts_have_no_strict_markers')?.passed).toBe(true);
  });
});
