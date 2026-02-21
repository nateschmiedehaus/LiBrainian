import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { createRefactoringLoopGateConstruction } from '../refactoring_loop_gate.js';

async function makeWorkspace(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `refactoring-loop-gate-${label}-`));
  return root;
}

describe('RefactoringLoopGate', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('bounces back substandard code with specific guidance and peer examples', async () => {
    const workspace = await makeWorkspace('bounce');
    dirs.push(workspace);

    const file = path.join(workspace, 'src', 'unsafe.ts');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `
export async function runDangerous(userInput: string) {
  const data = eval(userInput);
  return data;
}
`);

    const gate = createRefactoringLoopGateConstruction();
    const result = await gate.execute({
      workspace,
      changedFiles: [file],
      iteration: 1,
      maxIterations: 3,
      gateLevel: 4,
      l0CompilationPassed: true,
      l1TestsPassed: true,
      l3PeerDepthPercentile: 0.4,
      l4AgenticUtilityDelta: 0,
    });

    expect(result.pass).toBe(false);
    expect(result.failedLevels).toContain('L2');
    expect(result.requiredImprovements.length).toBeGreaterThan(0);
    expect(result.requiredImprovements[0]?.peerExample?.snippet?.length ?? 0).toBeGreaterThan(0);
    expect(result.requiredImprovements[0]?.suggestedFix?.length ?? 0).toBeGreaterThan(0);
  });

  it('tracks iteration and escalates to human review after max iterations', async () => {
    const workspace = await makeWorkspace('escalate');
    dirs.push(workspace);

    const file = path.join(workspace, 'src', 'broken.ts');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'export const x = 1;');

    const gate = createRefactoringLoopGateConstruction();
    const result = await gate.execute({
      workspace,
      changedFiles: [file],
      iteration: 3,
      maxIterations: 3,
      gateLevel: 4,
      l0CompilationPassed: false,
      l1TestsPassed: false,
      l3PeerDepthPercentile: 0.1,
      l4AgenticUtilityDelta: -0.2,
    });

    expect(result.pass).toBe(false);
    expect(result.escalateToHuman).toBe(true);
    expect(result.overrideAvailable).toBe(true);
    expect(result.failedLevels).toEqual(expect.arrayContaining(['L0', 'L1', 'L3', 'L4']));
  });

  it('accepts improved code on a later iteration', async () => {
    const workspace = await makeWorkspace('improve');
    dirs.push(workspace);

    const file = path.join(workspace, 'src', 'good.ts');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `
/**
 * Parse user input safely.
 */
export async function parseUserInput(input: string): Promise<string> {
  try {
    if (!input) {
      throw new Error('input is required');
    }
    return input.trim();
  } catch (error) {
    throw new Error('parseUserInput failed');
  }
}
`);

    const gate = createRefactoringLoopGateConstruction();
    const result = await gate.execute({
      workspace,
      changedFiles: [file],
      iteration: 2,
      maxIterations: 3,
      gateLevel: 4,
      l0CompilationPassed: true,
      l1TestsPassed: true,
      l3PeerDepthPercentile: 0.5,
      l4AgenticUtilityDelta: 0,
    });

    expect(result.pass).toBe(true);
    expect(result.escalateToHuman).toBe(false);
    expect(result.failedLevels).toHaveLength(0);
  });

  it('supports pre-commit mode by checking only L0-L2 gates', async () => {
    const workspace = await makeWorkspace('precommit');
    dirs.push(workspace);

    const file = path.join(workspace, 'src', 'precommit.ts');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'export function ok(value: string): string { return value.trim(); }');

    const gate = createRefactoringLoopGateConstruction();
    const result = await gate.execute({
      workspace,
      changedFiles: [file],
      iteration: 1,
      maxIterations: 3,
      gateLevel: 2,
      l0CompilationPassed: true,
      l1TestsPassed: true,
      l3PeerDepthPercentile: 0,
      l4AgenticUtilityDelta: -1,
    });

    expect(result.pass).toBe(true);
    expect(result.failedLevels).not.toContain('L3');
    expect(result.failedLevels).not.toContain('L4');
  });
});
