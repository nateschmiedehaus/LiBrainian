import { describe, expect, it } from 'vitest';
import { buildTestingTrackerReport } from '../testing_tracker.js';

describe('buildTestingTrackerReport', () => {
  it('reports publish-ready when all required artifacts are present and healthy', () => {
    const report = buildTestingTrackerReport({
      generatedAt: new Date(0).toISOString(),
      artifacts: {
        useCase: { present: true, path: '/tmp/use-case.json', data: { gate: { passed: true } } },
        liveFire: { present: true, path: '/tmp/live-fire.json', data: { gates: { passed: true } } },
        smoke: { present: true, path: '/tmp/smoke.json', data: { summary: { failures: 0 } } },
        testingDiscipline: { present: true, path: '/tmp/testing-discipline.json', data: { passed: true } },
      },
    });

    expect(report.summary.publishReady).toBe(true);
    expect(report.summary.openCount).toBe(0);
    expect(report.summary.unknownCount).toBe(0);
    expect(report.flaws.every((flaw) => flaw.status === 'fixed')).toBe(true);
  });

  it('marks missing artifacts as open', () => {
    const report = buildTestingTrackerReport({
      generatedAt: new Date(0).toISOString(),
      artifacts: {
        useCase: { present: false, path: '/tmp/use-case.json' },
        liveFire: { present: true, path: '/tmp/live-fire.json', data: { gates: { passed: true } } },
        smoke: { present: true, path: '/tmp/smoke.json', data: { summary: { failures: 0 } } },
        testingDiscipline: { present: true, path: '/tmp/testing-discipline.json', data: { passed: true } },
      },
    });

    expect(report.summary.publishReady).toBe(false);
    expect(report.summary.openCount).toBeGreaterThan(0);
    expect(report.flaws.find((flaw) => flaw.id === 'use_case_release_evidence')?.status).toBe('open');
  });
});
