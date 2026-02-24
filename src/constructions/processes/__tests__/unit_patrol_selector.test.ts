import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveUnitPatrolSelection,
  UNIT_PATROL_DEFAULT_EVALUATION,
  UNIT_PATROL_DEFAULT_SCENARIO,
  type UnitPatrolInput,
} from '../index.js';

async function withWorkspace(
  files: Array<{ relativePath: string; contents: string }>,
  run: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unit-patrol-selector-'));
  try {
    for (const file of files) {
      const absolutePath = path.join(workspace, file.relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, file.contents, 'utf8');
    }
    await run(workspace);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

describe('resolveUnitPatrolSelection', () => {
  it('returns deterministic selector output for identical input', async () => {
    await withWorkspace(
      [
        { relativePath: 'src/index.ts', contents: 'export function boot() { return true; }\n' },
        { relativePath: 'src/service.ts', contents: 'export const service = () => 1;\n' },
      ],
      async (workspace) => {
        const input: UnitPatrolInput = {
          fixtureRepoPath: workspace,
          task: 'metamorphic',
        };
        const first = await resolveUnitPatrolSelection(
          input,
          UNIT_PATROL_DEFAULT_SCENARIO,
          UNIT_PATROL_DEFAULT_EVALUATION,
        );
        const second = await resolveUnitPatrolSelection(
          input,
          UNIT_PATROL_DEFAULT_SCENARIO,
          UNIT_PATROL_DEFAULT_EVALUATION,
        );
        expect(first).toEqual(second);
        expect(first.profile).toBe('strict');
      },
    );
  });

  it('adapts domain and profile strategy packs across workspaces', async () => {
    await withWorkspace(
      [{ relativePath: 'app/main.py', contents: 'def main():\n    return True\n' }],
      async (workspace) => {
        const quickSelection = await resolveUnitPatrolSelection(
          {
            fixtureRepoPath: workspace,
            task: 'retrieval',
          },
          UNIT_PATROL_DEFAULT_SCENARIO,
          UNIT_PATROL_DEFAULT_EVALUATION,
        );
        expect(quickSelection.domain).toBe('python');
        expect(quickSelection.profile).toBe('quick');
        expect(quickSelection.strategyPack).toBe('quick');
        expect(quickSelection.scenario.operations.some((operation) => operation.kind === 'metamorphic')).toBe(false);

        const deepSelection = await resolveUnitPatrolSelection(
          {
            fixtureRepoPath: workspace,
            task: 'deep-audit',
          },
          UNIT_PATROL_DEFAULT_SCENARIO,
          UNIT_PATROL_DEFAULT_EVALUATION,
        );
        expect(deepSelection.profile).toBe('deep-bounded');
        expect(deepSelection.scenario.operations.filter((operation) => operation.kind === 'query').length).toBeLessThanOrEqual(
          deepSelection.budget.maxQueries,
        );
        expect(deepSelection.scenario.operations.some((operation) => operation.kind === 'metamorphic')).toBe(true);
      },
    );
  });

  it('enforces hard profile budgets on oversized custom scenarios', async () => {
    await withWorkspace(
      [{ relativePath: 'src/index.ts', contents: 'export function boot() { return true; }\n' }],
      async (workspace) => {
        const selection = await resolveUnitPatrolSelection(
          {
            fixtureRepoPath: workspace,
            profile: 'quick',
            scenario: {
              name: 'oversized',
              operations: [
                { kind: 'bootstrap' },
                { kind: 'query', query: { intent: 'first' } },
                { kind: 'query', query: { intent: 'second' } },
                { kind: 'metamorphic', query: { intent: 'meta' } },
                { kind: 'status' },
              ],
            },
          },
          UNIT_PATROL_DEFAULT_SCENARIO,
          UNIT_PATROL_DEFAULT_EVALUATION,
        );

        expect(selection.scenario.operations.length).toBeLessThanOrEqual(selection.budget.maxOperations);
        expect(selection.scenario.operations.filter((operation) => operation.kind === 'query').length).toBeLessThanOrEqual(
          selection.budget.maxQueries,
        );
        expect(selection.trace.enforcement.droppedOperations).toBeGreaterThan(0);
      },
    );
  });

  it('demonstrates bounded strategy-pack selection across three heterogeneous domain/task pairs', async () => {
    const demos: Array<{
      files: Array<{ relativePath: string; contents: string }>;
      input: Pick<UnitPatrolInput, 'task' | 'profile'>;
      expectedDomain: 'typescript' | 'python' | 'go';
      expectedProfile: 'quick' | 'strict' | 'deep-bounded';
    }> = [
      {
        files: [{ relativePath: 'src/index.ts', contents: 'export const ping = () => "pong";\n' }],
        input: { task: 'retrieval', profile: 'quick' },
        expectedDomain: 'typescript',
        expectedProfile: 'quick',
      },
      {
        files: [{ relativePath: 'app/main.py', contents: 'def main():\n    return True\n' }],
        input: { task: 'metamorphic', profile: 'strict' },
        expectedDomain: 'python',
        expectedProfile: 'strict',
      },
      {
        files: [{ relativePath: 'cmd/main.go', contents: 'package main\nfunc main() {}\n' }],
        input: { task: 'deep-audit', profile: 'deep-bounded' },
        expectedDomain: 'go',
        expectedProfile: 'deep-bounded',
      },
    ];

    for (const demo of demos) {
      await withWorkspace(demo.files, async (workspace) => {
        const selection = await resolveUnitPatrolSelection(
          {
            fixtureRepoPath: workspace,
            task: demo.input.task,
            profile: demo.input.profile,
          },
          UNIT_PATROL_DEFAULT_SCENARIO,
          UNIT_PATROL_DEFAULT_EVALUATION,
        );

        expect(selection.domain).toBe(demo.expectedDomain);
        expect(selection.profile).toBe(demo.expectedProfile);
        expect(selection.strategyPack).toBe(demo.expectedProfile);
        expect(selection.scenario.operations.length).toBeLessThanOrEqual(selection.budget.maxOperations);
        expect(selection.scenario.operations.filter((operation) => operation.kind === 'query').length).toBeLessThanOrEqual(
          selection.budget.maxQueries,
        );
        const metamorphicCount = selection.scenario.operations.filter((operation) => operation.kind === 'metamorphic').length;
        expect(metamorphicCount).toBeLessThanOrEqual(1);
      });
    }
  });
});
