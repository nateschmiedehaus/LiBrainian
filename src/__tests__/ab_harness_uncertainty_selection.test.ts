import { describe, expect, it } from 'vitest';
import type { AbTaskDefinition } from '../evaluation/ab_harness.js';
import {
  buildAbTaskUncertaintyScoresFromHistory,
  selectAbTasksForExecution,
} from '../evaluation/ab_harness.js';

function makeTask(id: string): AbTaskDefinition {
  return {
    id,
    repo: 'fixture',
    complexity: 'T3',
    description: `Task ${id}`,
    contextLevel: 3,
    targetFiles: ['src/feature.ts'],
    verification: {
      tests: ['node -e "process.exit(0)"'],
    },
    mode: 'agent_command',
  };
}

describe('ab harness uncertainty selection', () => {
  it('scores historically flaky tasks above stable tasks', () => {
    const scores = buildAbTaskUncertaintyScoresFromHistory({
      results: [
        { taskId: 'task-stable', success: true, failureReason: undefined, workerType: 'control' },
        { taskId: 'task-stable', success: true, failureReason: undefined, workerType: 'treatment' },
        { taskId: 'task-flaky', success: false, failureReason: 'agent_command_timeout', workerType: 'control' },
        { taskId: 'task-flaky', success: false, failureReason: 'agent_command_timeout', workerType: 'treatment' },
      ],
    });

    expect((scores.get('task-flaky') ?? 0)).toBeGreaterThan(scores.get('task-stable') ?? 1);
  });

  it('adaptive mode prioritizes high-uncertainty tasks and keeps one stable sentinel', () => {
    const tasks: AbTaskDefinition[] = [
      makeTask('task-stable-a'),
      makeTask('task-stable-b'),
      makeTask('task-uncertain-a'),
      makeTask('task-uncertain-b'),
      makeTask('task-uncertain-c'),
      makeTask('task-uncertain-d'),
    ];

    const selected = selectAbTasksForExecution(tasks, {
      maxTasks: 4,
      selectionMode: 'adaptive',
      uncertaintyScores: new Map<string, number>([
        ['task-stable-a', 0.03],
        ['task-stable-b', 0.05],
        ['task-uncertain-a', 0.95],
        ['task-uncertain-b', 0.82],
        ['task-uncertain-c', 0.74],
        ['task-uncertain-d', 0.69],
      ]),
    });

    expect(selected.map((task) => task.id)).toEqual([
      'task-uncertain-a',
      'task-uncertain-b',
      'task-uncertain-c',
      'task-stable-a',
    ]);
  });
});
