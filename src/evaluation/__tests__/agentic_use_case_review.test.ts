import { describe, expect, it } from 'vitest';
import {
  buildProgressiveUseCasePlan,
  distributeUseCasesAcrossRepos,
  evaluateUseCaseReviewGate,
  parseUseCaseMatrixMarkdown,
  selectRepoPlanWithinBudget,
  selectUseCases,
  summarizeUseCaseReview,
  type AgenticUseCaseRunResult,
} from '../agentic_use_case_review.js';

const SAMPLE_MATRIX = `
| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UC-001 | Orientation | Inventory files | none | ... | ... | planned |
| UC-002 | Orientation | Entry points | UC-001 | ... | ... | planned |
| UC-031 | Navigation | Locate symbols | UC-001 | ... | ... | planned |
| UC-081 | Runtime | Observability map | UC-031 | ... | ... | planned |
`;

describe('agentic use case review parsing', () => {
  it('parses UC rows from use-case matrix markdown', () => {
    const rows = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      id: 'UC-001',
      domain: 'Orientation',
      need: 'Inventory files',
      dependencies: [],
    });
    expect(rows[3]?.id).toBe('UC-081');
  });

  it('selects balanced coverage across domains', () => {
    const rows = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX);
    const selected = selectUseCases(rows, { maxUseCases: 3, selectionMode: 'balanced' });
    expect(selected).toHaveLength(3);
    const domains = new Set(selected.map((item) => item.domain));
    expect(domains.has('Orientation')).toBe(true);
    expect(domains.has('Navigation')).toBe(true);
    expect(domains.has('Runtime')).toBe(true);
  });

  it('builds progressive prerequisite plan before targets', () => {
    const rows = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX);
    const targets = rows.filter((row) => row.id === 'UC-081');
    const plan = buildProgressiveUseCasePlan(rows, targets, true);
    expect(plan.map((item) => item.id)).toEqual(['UC-001', 'UC-031', 'UC-081']);
    expect(plan[0]?.stepKind).toBe('prerequisite');
    expect(plan[2]?.stepKind).toBe('target');
    expect(plan[0]?.requiredByTargets).toEqual(['UC-081']);
  });

  it('caps per-repo planned runs while preserving at least one target step', () => {
    const rows = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX);
    const targets = rows.filter((row) => row.id === 'UC-081');
    const plan = buildProgressiveUseCasePlan(rows, targets, true);

    const bounded = selectRepoPlanWithinBudget(plan, 1);
    expect(bounded.length).toBeGreaterThanOrEqual(2);
    expect(bounded.some((entry) => entry.stepKind === 'target')).toBe(true);
    expect(bounded[0]?.id).toBe('UC-001');
    expect(bounded.at(-1)?.id).toBe('UC-081');
  });

  it('distributes selected use cases across repos without repeating the same subset', () => {
    const rows = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX);
    const selected = rows.slice(0, 4);
    const assignments = distributeUseCasesAcrossRepos(selected, ['repo-a', 'repo-b'], 2);
    const repoA = assignments.get('repo-a') ?? [];
    const repoB = assignments.get('repo-b') ?? [];
    const uniqueIds = new Set([...repoA, ...repoB].map((entry) => entry.id));

    expect(repoA).toHaveLength(2);
    expect(repoB).toHaveLength(2);
    expect(uniqueIds.size).toBe(4);
  });

});

describe('agentic use case review summary and gate', () => {
  const selectedUseCases = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX).slice(0, 2);
  const selectedRepos = ['repo-a', 'repo-b'];

  it('computes summary rates and domain metrics', () => {
    const runs: AgenticUseCaseRunResult[] = [
      {
        repo: 'repo-a',
        useCaseId: 'UC-001',
        domain: 'Orientation',
        intent: 'UC-001',
        stepKind: 'prerequisite',
        success: true,
        dependencyReady: true,
        missingPrerequisites: [],
        packCount: 2,
        evidenceCount: 3,
        hasUsefulSummary: true,
        totalConfidence: 0.8,
        strictSignals: [],
        errors: [],
      },
      {
        repo: 'repo-a',
        useCaseId: 'UC-002',
        domain: 'Orientation',
        intent: 'UC-002',
        stepKind: 'target',
        success: false,
        dependencyReady: false,
        missingPrerequisites: ['UC-001'],
        packCount: 1,
        evidenceCount: 1,
        hasUsefulSummary: false,
        totalConfidence: 0.2,
        strictSignals: ['fallback'],
        errors: ['fallback'],
      },
    ];

    const summary = summarizeUseCaseReview(runs, selectedUseCases, selectedRepos);
    expect(summary.totalRuns).toBe(2);
    expect(summary.passedRuns).toBe(1);
    expect(summary.passRate).toBe(0.5);
    expect(summary.evidenceRate).toBe(1);
    expect(summary.usefulSummaryRate).toBe(0.5);
    expect(summary.strictFailureShare).toBe(0.5);
    expect(summary.byDomain.Orientation?.runs).toBe(2);
    expect(summary.progression.prerequisiteRuns).toBe(1);
    expect(summary.progression.targetRuns).toBe(1);
    expect(summary.progression.targetDependencyReadyShare).toBe(0);
  });

  it('fails gate when strict-failure and quality thresholds are violated', () => {
    const allRows = parseUseCaseMatrixMarkdown(SAMPLE_MATRIX);
    const targetRows = allRows.filter((row) => row.id === 'UC-002');
    const runs: AgenticUseCaseRunResult[] = [
      {
        repo: 'repo-a',
        useCaseId: 'UC-002',
        domain: 'Orientation',
        intent: 'UC-002',
        stepKind: 'target',
        success: false,
        dependencyReady: false,
        missingPrerequisites: ['UC-001'],
        packCount: 0,
        evidenceCount: 0,
        hasUsefulSummary: false,
        totalConfidence: 0,
        strictSignals: ['unverified_by_trace'],
        errors: ['unverified_by_trace(provider_unavailable)'],
      },
    ];
    const plannedUseCases = buildProgressiveUseCasePlan(allRows, targetRows, true);
    const summary = summarizeUseCaseReview(runs, targetRows, ['repo-a'], {
      plannedUseCases,
      progressiveEnabled: true,
    });
    const gate = evaluateUseCaseReviewGate(summary, {
      minPassRate: 0.8,
      minEvidenceRate: 0.8,
      minUsefulSummaryRate: 0.8,
      maxStrictFailureShare: 0,
      minTargetDependencyReadyShare: 1,
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons.some((reason) => reason.startsWith('pass_rate_below_threshold:'))).toBe(true);
    expect(gate.reasons.some((reason) => reason.startsWith('strict_failure_share_above_threshold:'))).toBe(true);
    expect(gate.reasons.some((reason) => reason.startsWith('target_dependency_ready_share_below_threshold:'))).toBe(true);
  });
});
