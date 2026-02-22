import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSelfIndexDurabilityGateConstruction } from '../self_index_durability_gate.js';
import { unwrapConstructionExecutionResult } from '../../types.js';

const cleanupDirs: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('Self-Index Durability Gate', () => {
  it('detects drift and restores queryability across branch/rebase/history rewrite scenarios', async () => {
    const artifactDir = await makeTemp('librarian-self-index-durability-artifacts-');
    const outputPath = path.join(artifactDir, 'durability.json');
    const gate = createSelfIndexDurabilityGateConstruction();

    const result = unwrapConstructionExecutionResult(
      await gate.execute({
        outputPath,
        maxDurationMs: 300_000,
      }),
    );

    expect(result.kind).toBe('SelfIndexDurabilityGateResult.v1');
    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios.every((scenario) => scenario.preCheck.required)).toBe(true);
    expect(result.scenarios.every((scenario) => scenario.rebootstrapSucceeded)).toBe(true);
    expect(result.scenarios.every((scenario) => scenario.postCheck.required === false)).toBe(true);
    expect(result.scenarios.every((scenario) => scenario.postQueryPackCount > 0)).toBe(true);
    expect(result.pass).toBe(true);

    const artifactRaw = await fs.readFile(outputPath, 'utf8');
    const artifact = JSON.parse(artifactRaw) as { kind?: string; scenarios?: unknown[]; findings?: unknown[] };
    expect(artifact.kind).toBe('SelfIndexDurabilityGateResult.v1');
    expect(Array.isArray(artifact.scenarios)).toBe(true);
    expect(Array.isArray(artifact.findings)).toBe(true);
  }, 360_000);
});
