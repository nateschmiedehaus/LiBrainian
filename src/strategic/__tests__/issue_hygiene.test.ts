import { describe, it, expect } from 'vitest';
import {
  SHIP_BLOCKING_LABEL,
  POST_SHIP_LABEL,
  CAP_ELIGIBLE_LABEL,
  normalizeCloseReasonForGh,
  buildIssueHygienePlan,
  extractSection,
  getMissingEssentials,
  inferTaxonomy,
  normalizeSectionHeading,
  pickCapClosureCandidates,
  pinSelection,
  type IssueEnvelope,
} from '../issue_hygiene.js';

describe('issue_hygiene', () => {
  it('normalizes section heading aliases robustly', () => {
    expect(normalizeSectionHeading('## Acceptance Criteria')).toBe('acceptance criteria');
    expect(normalizeSectionHeading('### Repro/Evidence   ')).toBe('repro evidence');
  });

  it('extracts the first matching heading section', () => {
    const body = [
      'Some intro',
      '### Impact',
      'Customer cannot initialize on first run.',
      '',
      '### Reproduction steps',
      '1. Run init',
      '2. Observe issue',
      '',
      '### Acceptance criteria',
      '- Works on clean install',
      '- Tests cover startup path',
    ].join('\n');

    expect(extractSection(body, ['impact'])).toBe('Customer cannot initialize on first run.');
    expect(extractSection(body, ['acceptance criteria'])).toContain('Works on clean install');
  });

  it('detects missing essentials with placeholders', () => {
    const withMissing = [
      '### Impact',
      'N/A',
      '### Repro evidence',
      '',
      'npx tool reproduce',
      '### Acceptance criteria',
      'Pass integration test.',
    ].join('\n');
    expect(getMissingEssentials(withMissing)).toContain('Impact');
    expect(getMissingEssentials(withMissing)).not.toContain('Acceptance criteria');

    const complete = [
      '### Impact',
      'Duplicate query returns stale data.',
      '### Reproduction steps',
      '- Call /query with cached branch.',
      '### Acceptance criteria',
      '- Command returns fresh confidence score.',
    ].join('\n');
    expect(getMissingEssentials(complete)).toHaveLength(0);
  });

  it('treats triage placeholders as missing essentials', () => {
    const body = [
      '### Impact',
      '_No response_',
      '### Repro evidence',
      'n/a',
      '### Acceptance criteria',
      'TBD',
    ].join('\n');
    expect(getMissingEssentials(body)).toEqual(['Impact', 'Repro evidence', 'Acceptance criteria']);
  });

  it('infers explicit taxonomy overrides from labels', () => {
    expect(inferTaxonomy(new Set([SHIP_BLOCKING_LABEL]), 'Bug in startup path').taxonomy).toBe(SHIP_BLOCKING_LABEL);
    expect(inferTaxonomy(new Set([POST_SHIP_LABEL]), 'New design discussion').taxonomy).toBe(POST_SHIP_LABEL);
  });

  it('defaults to ship-blocking when both taxonomy labels are present', () => {
    expect(inferTaxonomy(new Set([SHIP_BLOCKING_LABEL, POST_SHIP_LABEL]), 'New design discussion').taxonomy)
      .toBe(SHIP_BLOCKING_LABEL);
  });

  it('infers ship vs post by label and title signal', () => {
    expect(inferTaxonomy(new Set(['kind/feature']), 'Roadmap exploration: query ranking improvements').taxonomy)
      .toBe(POST_SHIP_LABEL);
    expect(inferTaxonomy(new Set(['kind/bug', 'priority: high']), 'Fix regression in live-fire path').taxonomy)
      .toBe(SHIP_BLOCKING_LABEL);
  });

  it('uses created time for missing-essentials closure', () => {
    const now = new Date('2026-02-01T00:00:00.000Z');
    const issue = {
      number: 101,
      title: 'Example issue',
      body: '### Impact\nMissing data\n\n### Repro evidence\nNo data\n',
      labels: [],
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2026-01-31T00:00:00.000Z',
      commentCount: 0,
      isPinned: false,
    } as IssueEnvelope;

    const plan = buildIssueHygienePlan(issue, {
      now,
      missingEssentialsWindowDays: 14,
      staleWindowDays: 90,
    });

    expect(plan.closeForMissingEssentials).toBe(true);
    expect(plan.closeForStaleNoActivity).toBe(false);
  });

  it('picks post-ship closure candidates after immediate closures', () => {
    const plans = [
      {
        number: 1,
        title: 'Backlog cleanup',
        labelSet: new Set(['post-ship', CAP_ELIGIBLE_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: POST_SHIP_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 120,
        urgencyScore: 20,
      },
      {
        number: 2,
        title: 'Needs design alignment',
        labelSet: new Set(['post-ship', CAP_ELIGIBLE_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: POST_SHIP_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 30,
        urgencyScore: 60,
      },
      {
        number: 3,
        title: 'Blocking regression',
        labelSet: new Set([SHIP_BLOCKING_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: SHIP_BLOCKING_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 200,
        urgencyScore: 95,
      },
    ];

    const closures = pickCapClosureCandidates(plans, 1, plans.length, new Set([3]));
    expect(closures).toHaveLength(1);
    expect(closures[0].number).toBe(1);
  });

  it('never selects protected issues for cap closure', () => {
    const plans = [
      {
        number: 21,
        title: 'M0: Dogfood self-hosting gate',
        labelSet: new Set(['post-ship', CAP_ELIGIBLE_LABEL, 'priority: critical']),
        milestoneTitle: 'M0: Dogfood-Ready',
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: POST_SHIP_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 180,
        urgencyScore: 12,
      },
      {
        number: 22,
        title: 'Low-priority naming cleanup',
        labelSet: new Set(['post-ship', CAP_ELIGIBLE_LABEL, 'priority: low']),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: POST_SHIP_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 180,
        urgencyScore: 12,
      },
    ];

    const closures = pickCapClosureCandidates(plans, 0, plans.length, new Set());
    expect(closures).toHaveLength(1);
    expect(closures[0].number).toBe(22);
  });

  it('selects top ship-blocking issues for pinning', () => {
    const plans = [
      {
        number: 11,
        title: 'Blocking issue A',
        labelSet: new Set([SHIP_BLOCKING_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: SHIP_BLOCKING_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 90,
        urgencyScore: 70,
      },
      {
        number: 12,
        title: 'Blocking issue B',
        labelSet: new Set([SHIP_BLOCKING_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: SHIP_BLOCKING_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 30,
        urgencyScore: 95,
      },
      {
        number: 13,
        title: 'Blocking issue C',
        labelSet: new Set([SHIP_BLOCKING_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: SHIP_BLOCKING_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: false,
        closeForStaleNoActivity: false,
        ageDays: 150,
        urgencyScore: 95,
      },
      {
        number: 14,
        title: 'Blocking issue D',
        labelSet: new Set([SHIP_BLOCKING_LABEL]),
        hasEssentialGap: false,
        missingEssentials: [],
        recommendedTaxonomy: SHIP_BLOCKING_LABEL,
        taxonomyReasons: [],
        hasConflictingTaxonomy: false,
        missingTaxonomyLabel: false,
        closeForMissingEssentials: true,
        closeForStaleNoActivity: false,
        ageDays: 200,
        urgencyScore: 100,
      },
    ];

    expect(pinSelection(plans, 2)).toEqual([12, 13]);
  });

  it('normalizes not_planned to gh-compatible close reason', () => {
    expect(normalizeCloseReasonForGh('not_planned')).toBe('not planned');
    expect(normalizeCloseReasonForGh('not planned')).toBe('not planned');
    expect(normalizeCloseReasonForGh('completed')).toBe('completed');
  });
});
