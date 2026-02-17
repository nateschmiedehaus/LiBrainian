import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TaskDefinition {
  id: string;
  description?: string;
  contextByLevel?: Record<string, string[]>;
}

describe('A/B taskpack quality guards', () => {
  it('pins exact expected hint text for error-hint mapping bugfix task', () => {
    const taskpackPath = resolve(process.cwd(), 'eval-corpus', 'ab-harness', 'tasks.agentic_bugfix.json');
    const payload = JSON.parse(readFileSync(taskpackPath, 'utf8')) as { tasks?: TaskDefinition[] };
    const task = payload.tasks?.find((candidate) => candidate.id === 'srtd-bugfix-error-hint-mapping');

    expect(task).toBeDefined();
    expect(task?.description).toContain(
      "'Table or view does not exist. Ensure the migration that creates it has run first.'"
    );
    expect(task?.contextByLevel?.L1 ?? []).toContain('src/utils/errorHints.test.ts');
  });
});
