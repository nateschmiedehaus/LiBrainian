import { describe, expect, it } from 'vitest';
import { buildProgressiveUseCasePlan, parseUseCaseMatrixMarkdown } from '../evaluation/agentic_use_case_review.js';

describe('agentic use-case progressive planning order', () => {
  it('schedules prerequisites before dependent targets even when IDs are higher', () => {
    const rows = parseUseCaseMatrixMarkdown(`
| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UC-201 | Project | Create milestone plan | UC-202 | ... | ... | planned |
| UC-202 | Project | Build dependency timeline | none | ... | ... | planned |
    `);
    const targets = rows.filter((row) => row.id === 'UC-201');
    const plan = buildProgressiveUseCasePlan(rows, targets, true);
    expect(plan.map((item) => item.id)).toEqual(['UC-202', 'UC-201']);
    expect(plan[0]?.stepKind).toBe('prerequisite');
    expect(plan[1]?.stepKind).toBe('target');
  });

  it('does not include target itself when dependencies contain a cycle', () => {
    const rows = parseUseCaseMatrixMarkdown(`
| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UC-231 | Knowledge | Capture feedback | UC-238 | ... | ... | planned |
| UC-238 | Knowledge | Track review outcomes | UC-231 | ... | ... | planned |
    `);
    const targets = rows.filter((row) => row.id === 'UC-231');
    const plan = buildProgressiveUseCasePlan(rows, targets, true);
    const target = plan.find((item) => item.id === 'UC-231');
    expect(target?.stepKind).toBe('target');
    expect(target?.dependencies).toEqual(['UC-238']);
    expect(plan.map((item) => item.id)).toEqual(['UC-238', 'UC-231']);
  });
});
