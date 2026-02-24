import { describe, expect, it } from 'vitest';
import {
  evaluateIssueClosureHygiene,
  requiresReleaseGradeClosureEvidence,
  type IssueClosureHygieneInput,
} from '../issue_hygiene.js';

function issue(overrides: Partial<IssueClosureHygieneInput>): IssueClosureHygieneInput {
  return {
    number: 0,
    url: 'https://example.com/issue/0',
    title: 'placeholder',
    state: 'closed',
    milestoneTitle: null,
    labels: [],
    body: '',
    comments: [],
    ...overrides,
  };
}

describe('issue closure hygiene policy', () => {
  it('requires release-grade evidence for M0 issues', () => {
    const input = issue({
      number: 752,
      milestoneTitle: 'M0: Dogfood-Ready',
      comments: [
        [
          '**What changed:** Added closure hygiene enforcement.',
          '**Tests added:** src/strategic/__tests__/issue_hygiene.test.ts',
          '**Verified by:** npm run build && npm test',
        ].join('\n'),
      ],
    });

    expect(requiresReleaseGradeClosureEvidence(input)).toBe(true);
    const result = evaluateIssueClosureHygiene(input);
    expect(result.compliant).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('fails required issues missing explicit evidence block', () => {
    const input = issue({
      number: 753,
      milestoneTitle: 'M0: Dogfood-Ready',
      comments: ['Fixed in abc123'],
    });

    const result = evaluateIssueClosureHygiene(input);
    expect(result.compliant).toBe(false);
    expect(result.findings.some((finding) => finding.code === 'missing_evidence_block')).toBe(true);
  });

  it('fails ship-blocking issues when verified-by omits build and test', () => {
    const input = issue({
      number: 754,
      milestoneTitle: null,
      labels: ['priority: critical', 'kind/bug'],
      comments: [
        [
          '**What changed:** Fixed provider selection bug.',
          '**Tests added:** src/api/__tests__/provider_selection.test.ts',
          '**Verified by:** npm run test:changed',
        ].join('\n'),
      ],
    });

    const result = evaluateIssueClosureHygiene(input);
    expect(result.compliant).toBe(false);
    expect(result.findings.some((finding) => finding.code === 'missing_build_and_test_verification')).toBe(true);
  });

  it('flags deferred closures as policy violations', () => {
    const input = issue({
      number: 755,
      milestoneTitle: 'M0: Dogfood-Ready',
      body: 'Deferring to baseline stabilization track.',
      comments: [
        '**What changed:** Deferred.',
        '**Tests added:** none',
        '**Verified by:** npm run build && npm test',
      ],
    });

    const result = evaluateIssueClosureHygiene(input);
    expect(result.compliant).toBe(false);
    expect(result.findings.some((finding) => finding.code === 'deferred_issue_must_remain_open')).toBe(true);
  });

  it('does not require release-grade evidence for non-M0 non-ship-blocking issues', () => {
    const input = issue({
      number: 756,
      milestoneTitle: 'M2: Agent Integration',
      labels: ['priority: low', 'kind/feature'],
      comments: [],
    });

    const result = evaluateIssueClosureHygiene(input);
    expect(requiresReleaseGradeClosureEvidence(input)).toBe(false);
    expect(result.compliant).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('allows deferred notes on open issues when linked to baseline issue', () => {
    const input = issue({
      number: 757,
      state: 'open',
      milestoneTitle: 'M0: Dogfood-Ready',
      body: 'Deferred to baseline issue #900 while this remains open.',
      comments: [],
    });

    const result = evaluateIssueClosureHygiene(input);
    expect(result.findings.some((finding) => finding.code === 'deferred_issue_must_remain_open')).toBe(false);
  });
});
