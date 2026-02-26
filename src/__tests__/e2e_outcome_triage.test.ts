import { describe, expect, it } from 'vitest';

import { buildTriage, parseArgs } from '../../scripts/e2e-outcome-triage.mjs';

describe('e2e outcome triage defaults', () => {
  it('uses default-on issue creation path with nonzero max issues', () => {
    const parsed = parseArgs([]);
    expect(parsed.createGhIssues).toBe(true);
    expect(parsed.includeImmediate).toBe(true);
    expect(parsed.maxIssues).toBe(5);
    expect(parsed.planArtifact).toBeNull();
    expect(parsed.planMarkdown).toBeNull();
  });
});

describe('e2e outcome triage findings', () => {
  it('adds a meta remediation candidate alongside specific findings for failing reports', () => {
    const triage = buildTriage({
      status: 'failed',
      failures: ['insufficient_natural_tasks:4<20'],
      diagnoses: [],
      suggestions: ['Increase natural task coverage'],
      kind: 'E2EOutcomeReport.v1',
      createdAt: new Date().toISOString(),
      sample: {
        naturalTaskCount: 4,
        pairedTaskCount: 0,
      },
    });

    const keys = triage.issueCandidates.map((candidate) => candidate.key);
    expect(keys).toContain('outcome-sample-size-insufficient');
    expect(keys).toContain('meta-e2e-remediation-loop');
    expect(triage.summary.issueCandidates).toBeGreaterThanOrEqual(2);
  });

  it('does not add meta remediation candidates when the report passed with no findings', () => {
    const triage = buildTriage({
      status: 'passed',
      failures: [],
      diagnoses: [],
      suggestions: [],
      kind: 'E2EOutcomeReport.v1',
      createdAt: new Date().toISOString(),
      sample: {
        naturalTaskCount: 25,
        pairedTaskCount: 10,
      },
    });

    expect(triage.summary.findings).toBe(0);
    expect(triage.summary.issueCandidates).toBe(0);
  });
});
