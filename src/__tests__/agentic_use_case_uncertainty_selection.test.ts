import { describe, expect, it } from 'vitest';
import type { AgenticUseCase } from '../evaluation/agentic_use_case_review.js';
import {
  buildHistoryStatsFromHistory,
  buildUncertaintyScoresFromHistory,
  selectUseCases,
} from '../evaluation/agentic_use_case_review.js';

describe('agentic use-case uncertainty prioritization', () => {
  it('prioritizes high-uncertainty use cases over stable ones', () => {
    const useCases: AgenticUseCase[] = [
      { id: 'UC-001', domain: 'Orientation', need: 'Stable baseline', dependencies: [] },
      { id: 'UC-002', domain: 'Build/Test', need: 'Moderate uncertainty', dependencies: [] },
      { id: 'UC-003', domain: 'Runtime', need: 'High uncertainty', dependencies: [] },
      { id: 'UC-004', domain: 'Security', need: 'Medium uncertainty', dependencies: [] },
    ];

    const selected = selectUseCases(useCases, {
      maxUseCases: 2,
      selectionMode: 'uncertainty',
      uncertaintyScores: new Map<string, number>([
        ['UC-001', 0.02],
        ['UC-002', 0.45],
        ['UC-003', 0.88],
        ['UC-004', 0.61],
      ]),
    });

    expect(selected.map((entry) => entry.id)).toEqual(['UC-003', 'UC-004']);
  });

  it('computes lower uncertainty for consistently passing cases', () => {
    const scores = buildUncertaintyScoresFromHistory({
      results: [
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-002', success: false, strictSignals: ['timeout'], dependencyReady: false },
      ],
    });

    const stable = scores.get('UC-001') ?? 1;
    const unstable = scores.get('UC-002') ?? 0;
    expect(stable).toBeLessThan(unstable);
  });

  it('uses adaptive mode to focus uncertain cases while retaining stable sentinels', () => {
    const useCases: AgenticUseCase[] = [
      { id: 'UC-001', domain: 'Orientation', need: 'Stable A', dependencies: [] },
      { id: 'UC-002', domain: 'Orientation', need: 'Stable B', dependencies: [] },
      { id: 'UC-003', domain: 'Runtime', need: 'Uncertain A', dependencies: [] },
      { id: 'UC-004', domain: 'Runtime', need: 'Uncertain B', dependencies: [] },
      { id: 'UC-005', domain: 'Security', need: 'Uncertain C', dependencies: [] },
      { id: 'UC-006', domain: 'Security', need: 'Uncertain D', dependencies: [] },
    ];

    const selected = selectUseCases(useCases, {
      maxUseCases: 4,
      selectionMode: 'adaptive',
      uncertaintyScores: new Map<string, number>([
        ['UC-001', 0.02],
        ['UC-002', 0.04],
        ['UC-003', 0.95],
        ['UC-004', 0.84],
        ['UC-005', 0.71],
        ['UC-006', 0.68],
      ]),
    });

    expect(selected.map((entry) => entry.id)).toEqual(['UC-003', 'UC-004', 'UC-005', 'UC-001']);
  });

  it('uses probabilistic mode to strongly de-prioritize repeatedly successful cases', () => {
    const useCases: AgenticUseCase[] = [
      { id: 'UC-001', domain: 'Orientation', need: 'Very stable A', dependencies: [] },
      { id: 'UC-002', domain: 'Orientation', need: 'Very stable B', dependencies: [] },
      { id: 'UC-003', domain: 'Orientation', need: 'Recently failed', dependencies: [] },
      { id: 'UC-004', domain: 'Orientation', need: 'Untested high-uncertainty', dependencies: [] },
      { id: 'UC-005', domain: 'Orientation', need: 'Strict failure', dependencies: [] },
    ];
    const history = {
      results: [
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-001', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-002', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-002', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-002', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-002', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-002', success: true, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-003', success: false, strictSignals: [], dependencyReady: true },
        { useCaseId: 'UC-005', success: false, strictSignals: ['timeout'], dependencyReady: false },
      ],
    };
    const uncertaintyScores = buildUncertaintyScoresFromHistory(history);
    uncertaintyScores.set('UC-004', 0.9);
    const historyStats = buildHistoryStatsFromHistory(history);

    const selected = selectUseCases(useCases, {
      maxUseCases: 3,
      selectionMode: 'probabilistic',
      uncertaintyScores,
      historyStats,
    });
    const selectedIds = selected.map((entry) => entry.id);

    expect(selectedIds).toContain('UC-003');
    expect(selectedIds).toContain('UC-004');
    expect(selectedIds).toContain('UC-005');
    expect(selectedIds).not.toContain('UC-001');
    expect(selectedIds).not.toContain('UC-002');
  });
});
