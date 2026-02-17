import { describe, expect, it } from 'vitest';
import {
  buildTestingTrackerReport,
  type TestingTrackerInput,
} from '../evaluation/testing_tracker.js';

function createBaselineInput(): TestingTrackerInput {
  return {
    generatedAt: '2026-02-15T00:00:00.000Z',
    artifacts: {
      ab: {
        present: true,
        data: {
          gates: {
            thresholds: {
              requireT3CeilingTimeReduction: true,
            },
          },
          diagnostics: {
            verificationFallbackShare: 0,
            artifactIntegrityShare: 1,
            agentVerifiedExecutionShare: 1,
            failureReasons: {},
            criticalFailureReasons: {},
          },
          t3PlusLift: {
            successRateLift: 0.3,
            absoluteSuccessRateDelta: 0.1,
            controlSuccessRate: 0.4,
            treatmentSuccessRate: 0.5,
            timeReduction: 0.04,
            agentCommandTimeReduction: 0.05,
            significance: {
              statisticallySignificant: true,
              sampleSizeAdequate: true,
            },
          },
        },
      },
      useCase: {
        present: true,
        data: {
          summary: {
            strictFailureShare: 0,
          },
        },
      },
      liveFire: {
        present: true,
        data: {
          gates: { passed: true },
        },
      },
      smoke: {
        present: true,
        data: {
          summary: { failures: 0 },
        },
      },
      testingDiscipline: {
        present: true,
        data: {
          passed: true,
          summary: { failedBlockingChecks: 0 },
        },
      },
      publishGate: {
        present: true,
        data: {
          passed: true,
          summary: { blockerCount: 0, warningCount: 0 },
        },
      },
    },
  };
}

describe('buildTestingTrackerReport', () => {
  it('marks publish-ready only when all tracked flaws are fixed', () => {
    const report = buildTestingTrackerReport(createBaselineInput());

    expect(report.summary.publishReady).toBe(true);
    expect(report.summary.openCount).toBe(0);
    expect(report.summary.unknownCount).toBe(0);
    expect(report.summary.fixedCount).toBe(report.flaws.length);
  });

  it('marks A/B superiority as open when lift is below threshold', () => {
    const input = createBaselineInput();
    if (input.artifacts.ab.data && input.artifacts.ab.present) {
      input.artifacts.ab.data.t3PlusLift.successRateLift = 0.1;
      input.artifacts.ab.data.t3PlusLift.significance.statisticallySignificant = false;
    }

    const report = buildTestingTrackerReport(input);
    const superiority = report.flaws.find((item) => item.id === 'ab_superiority_signal');

    expect(superiority?.status).toBe('open');
    expect(report.summary.publishReady).toBe(false);
  });

  it('marks timeout fragility as open when timeout failures are present', () => {
    const input = createBaselineInput();
    if (input.artifacts.ab.data && input.artifacts.ab.present) {
      input.artifacts.ab.data.diagnostics.failureReasons = { agent_command_timeout: 2 };
    }

    const report = buildTestingTrackerReport(input);
    const timeout = report.flaws.find((item) => item.id === 'ab_timeout_fragility');

    expect(timeout?.status).toBe('open');
    expect(report.summary.publishReady).toBe(false);
  });

  it('marks missing artifact-backed flaws as unknown', () => {
    const input = createBaselineInput();
    input.artifacts.useCase = { present: false };

    const report = buildTestingTrackerReport(input);
    const useCase = report.flaws.find((item) => item.id === 'use_case_strict_marker_control');

    expect(useCase?.status).toBe('unknown');
    expect(report.summary.unknownCount).toBeGreaterThan(0);
    expect(report.summary.publishReady).toBe(false);
  });

  it('treats ceiling-mode parity as fixed when A/B disables ceiling time threshold', () => {
    const input = createBaselineInput();
    if (input.artifacts.ab.data && input.artifacts.ab.present) {
      input.artifacts.ab.data.gates = {
        thresholds: {
          requireT3CeilingTimeReduction: false,
        },
      };
      input.artifacts.ab.data.t3PlusLift = {
        successRateLift: 0,
        absoluteSuccessRateDelta: 0,
        controlSuccessRate: 1,
        treatmentSuccessRate: 1,
        timeReduction: -0.02,
        agentCommandTimeReduction: -0.01,
        significance: {
          statisticallySignificant: null,
          sampleSizeAdequate: true,
        },
      };
    }

    const report = buildTestingTrackerReport(input);
    const superiority = report.flaws.find((item) => item.id === 'ab_superiority_signal');

    expect(superiority?.status).toBe('fixed');
  });
});
