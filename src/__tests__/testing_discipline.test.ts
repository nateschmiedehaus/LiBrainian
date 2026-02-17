import { describe, expect, it } from 'vitest';
import type { CompositionUtilityReport } from '../evaluation/composition_utility.js';
import { evaluateTestingDiscipline } from '../evaluation/testing_discipline.js';

function createPassingCompositionReport(): CompositionUtilityReport {
  return {
    generatedAt: new Date(0).toISOString(),
    totalScenarios: 8,
    passedScenarios: 8,
    passRate: 1,
    top1Accuracy: 0.75,
    top3Recall: 1,
    scenarioResults: [],
    failures: [],
  };
}

describe('testing discipline evaluation', () => {
  it('passes when all discipline checks are satisfied', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 0, agent_command: 2 },
          verificationFallbackShare: 0,
          verificationFallbackRuns: 0,
        },
        results: [
          {
            workerType: 'control',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: [],
          },
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/foo.ts'],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 1,
          evidenceRate: 1,
          usefulSummaryRate: 1,
          strictFailureShare: 0,
          uniqueRepos: 8,
          uniqueUseCases: 15,
        },
      },
      liveFireReport: {
        options: { llmModes: ['disabled', 'optional'] },
        aggregate: {
          totalRuns: 4,
          passRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true },
      },
      externalSmokeReport: {
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'typedriver-ts', language: 'typescript' },
          { repo: 'token-explorer-py', language: 'python' },
          { repo: 'tlsproxy-go', language: 'go' },
        ],
      },
      compositionUtilityReport: createPassingCompositionReport(),
      constructableSamples: [
        { repo: 'typedriver-ts', primaryLanguage: 'typescript', enabledConstructables: ['typescript-patterns'] },
        { repo: 'token-explorer-py', primaryLanguage: 'python', enabledConstructables: ['python-patterns'] },
        { repo: 'tlsproxy-go', primaryLanguage: 'go', enabledConstructables: ['go-patterns'] },
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.summary.failedBlockingChecks).toBe(0);
    expect(report.summary.totalChecks).toBe(10);
  });

  it('ignores undefined threshold overrides', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 0, agent_command: 2 },
          verificationFallbackShare: 0,
          verificationFallbackRuns: 0,
        },
        results: [
          {
            workerType: 'control',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: [],
          },
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/foo.ts'],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 1,
          evidenceRate: 1,
          usefulSummaryRate: 1,
          strictFailureShare: 0,
          uniqueRepos: 8,
          uniqueUseCases: 20,
        },
      },
      liveFireReport: {
        options: { llmModes: ['disabled', 'optional'] },
        aggregate: {
          totalRuns: 4,
          passRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true },
      },
      externalSmokeReport: {
        summary: { total: 4, failures: 0 },
        results: [
          { repo: 'repo-a', language: 'typescript' },
          { repo: 'repo-b', language: 'python' },
          { repo: 'repo-c', language: 'go' },
          { repo: 'repo-d', language: 'rust' },
        ],
      },
      compositionUtilityReport: createPassingCompositionReport(),
      constructableSamples: [
        { repo: 'repo-a', primaryLanguage: 'typescript', enabledConstructables: ['typescript-patterns'] },
        { repo: 'repo-b', primaryLanguage: 'python', enabledConstructables: ['python-patterns'] },
        { repo: 'repo-c', primaryLanguage: 'go', enabledConstructables: ['go-patterns'] },
      ],
      thresholds: {
        minUseCasePassRate: undefined,
        minUseCaseEvidenceRate: undefined,
      },
    });

    expect(report.passed).toBe(true);
  });

  it('fails td_01 when diagnostics mode counts do not match actual runs', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 0, agent_command: 4 },
          verificationFallbackShare: 0,
          verificationFallbackRuns: 0,
        },
        results: [
          {
            workerType: 'control',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: [],
          },
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/foo.ts'],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 1,
          evidenceRate: 1,
          usefulSummaryRate: 1,
          strictFailureShare: 0,
          uniqueRepos: 8,
          uniqueUseCases: 15,
        },
      },
      liveFireReport: {
        options: { llmModes: ['disabled', 'optional'] },
        aggregate: {
          totalRuns: 4,
          passRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true },
      },
      externalSmokeReport: {
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'typedriver-ts', language: 'typescript' },
          { repo: 'token-explorer-py', language: 'python' },
          { repo: 'tlsproxy-go', language: 'go' },
        ],
      },
      compositionUtilityReport: createPassingCompositionReport(),
      constructableSamples: [
        { repo: 'typedriver-ts', primaryLanguage: 'typescript', enabledConstructables: ['typescript-patterns'] },
        { repo: 'token-explorer-py', primaryLanguage: 'python', enabledConstructables: ['python-patterns'] },
        { repo: 'tlsproxy-go', primaryLanguage: 'go', enabledConstructables: ['go-patterns'] },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'td_01_ab_agent_mode_purity')?.passed).toBe(false);
  });

  it('fails td_03 when control runs are contaminated with treatment context', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 0, agent_command: 2 },
          verificationFallbackShare: 0,
          verificationFallbackRuns: 0,
        },
        results: [
          {
            workerType: 'control',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/should-not-be-here.ts'],
          },
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/foo.ts'],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 1,
          evidenceRate: 1,
          usefulSummaryRate: 1,
          strictFailureShare: 0,
          uniqueRepos: 8,
          uniqueUseCases: 15,
        },
      },
      liveFireReport: {
        options: { llmModes: ['disabled', 'optional'] },
        aggregate: {
          totalRuns: 4,
          passRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true },
      },
      externalSmokeReport: {
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'typedriver-ts', language: 'typescript' },
          { repo: 'token-explorer-py', language: 'python' },
          { repo: 'tlsproxy-go', language: 'go' },
        ],
      },
      compositionUtilityReport: createPassingCompositionReport(),
      constructableSamples: [
        { repo: 'typedriver-ts', primaryLanguage: 'typescript', enabledConstructables: ['typescript-patterns'] },
        { repo: 'token-explorer-py', primaryLanguage: 'python', enabledConstructables: ['python-patterns'] },
        { repo: 'tlsproxy-go', primaryLanguage: 'go', enabledConstructables: ['go-patterns'] },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'td_03_ab_treatment_context_localization')?.passed).toBe(false);
  });

  it('fails td_08 when smoke summary disagrees with run-level failures', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 0, agent_command: 2 },
          verificationFallbackShare: 0,
          verificationFallbackRuns: 0,
        },
        results: [
          {
            workerType: 'control',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: [],
          },
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/foo.ts'],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 1,
          evidenceRate: 1,
          usefulSummaryRate: 1,
          strictFailureShare: 0,
          uniqueRepos: 8,
          uniqueUseCases: 15,
        },
      },
      liveFireReport: {
        options: { llmModes: ['disabled', 'optional'] },
        aggregate: {
          totalRuns: 4,
          passRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true },
      },
      externalSmokeReport: {
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'typedriver-ts', language: 'typescript', success: true },
          { repo: 'token-explorer-py', language: 'python', success: false, failureReason: 'timeout' },
          { repo: 'tlsproxy-go', language: 'go', success: true },
        ],
      },
      compositionUtilityReport: createPassingCompositionReport(),
      constructableSamples: [
        { repo: 'typedriver-ts', primaryLanguage: 'typescript', enabledConstructables: ['typescript-patterns'] },
        { repo: 'token-explorer-py', primaryLanguage: 'python', enabledConstructables: ['python-patterns'] },
        { repo: 'tlsproxy-go', primaryLanguage: 'go', enabledConstructables: ['go-patterns'] },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'td_08_external_smoke_cross_language')?.passed).toBe(false);
  });

  it('fails td_10 as a blocking gate when language constructables are missing', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 0, agent_command: 2 },
          verificationFallbackShare: 0,
          verificationFallbackRuns: 0,
        },
        results: [
          {
            workerType: 'control',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: [],
          },
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: false },
            artifactIntegrity: { complete: true },
            extraContextFiles: ['src/foo.ts'],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 1,
          evidenceRate: 1,
          usefulSummaryRate: 1,
          strictFailureShare: 0,
          uniqueRepos: 8,
          uniqueUseCases: 15,
        },
      },
      liveFireReport: {
        options: { llmModes: ['disabled', 'optional'] },
        aggregate: {
          totalRuns: 4,
          passRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true },
      },
      externalSmokeReport: {
        summary: { total: 3, failures: 0 },
        results: [
          { repo: 'typedriver-ts', language: 'typescript' },
          { repo: 'token-explorer-py', language: 'python' },
          { repo: 'tlsproxy-go', language: 'go' },
        ],
      },
      compositionUtilityReport: createPassingCompositionReport(),
      constructableSamples: [
        { repo: 'typedriver-ts', primaryLanguage: 'typescript', enabledConstructables: ['typescript-patterns'] },
        { repo: 'token-explorer-py', primaryLanguage: 'python', enabledConstructables: [] },
        { repo: 'tlsproxy-go', primaryLanguage: 'go', enabledConstructables: ['go-patterns'] },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'td_10_constructable_auto_adaptation')?.severity).toBe('blocking');
    expect(report.checks.find((check) => check.id === 'td_10_constructable_auto_adaptation')?.passed).toBe(false);
  });

  it('fails closed when fallback and strict markers appear anywhere in release evidence', () => {
    const report = evaluateTestingDiscipline({
      abReport: {
        diagnostics: {
          modeCounts: { deterministic_edit: 1, agent_command: 1 },
          verificationFallbackShare: 0.25,
          verificationFallbackRuns: 1,
        },
        results: [
          {
            workerType: 'treatment',
            mode: 'agent_command',
            success: true,
            verification: { baseline: { passed: false }, tests: { passed: true } },
            verificationPolicy: { verificationCommandsConfigured: 1, verificationFallbackUsed: true },
            artifactIntegrity: { complete: true },
            extraContextFiles: [],
          },
        ],
      },
      useCaseReport: {
        summary: {
          passRate: 0.7,
          evidenceRate: 0.8,
          usefulSummaryRate: 0.7,
          strictFailureShare: 0.1,
          uniqueRepos: 2,
          uniqueUseCases: 4,
        },
        trace: 'unverified_by_trace(provider_unavailable)',
      },
      liveFireReport: {
        options: { llmModes: ['disabled'] },
        aggregate: {
          totalRuns: 1,
          passRate: 0.5,
          meanRetrievedContextRate: 0.5,
          meanBlockingValidationRate: 0.2,
        },
        gates: { passed: false },
      },
      externalSmokeReport: {
        summary: { total: 1, failures: 1 },
        results: [{ repo: 'typedriver-ts', language: 'typescript' }],
      },
      compositionUtilityReport: {
        ...createPassingCompositionReport(),
        passRate: 0.5,
        top1Accuracy: 0.2,
        top3Recall: 0.5,
      },
      constructableSamples: [{ repo: 'typedriver-ts', primaryLanguage: 'typescript', enabledConstructables: [] }],
    });

    expect(report.passed).toBe(false);
    expect(report.summary.failedBlockingChecks).toBeGreaterThan(0);
    expect(report.checks.find((check) => check.id === 'td_01_ab_agent_mode_purity')?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'td_05_ab_no_fallback_no_strict_markers')?.passed).toBe(false);
  });
});
