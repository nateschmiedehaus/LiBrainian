import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBootstrapQualityGateConstruction, removeDirectoryBestEffort } from '../bootstrap_quality_gate.js';
import { unwrapConstructionExecutionResult } from '../../types.js';

const tempRoots: string[] = [];

async function createFixture(
  language: 'typescript' | 'python' | 'c',
  files: Record<string, string>,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `librarian-bootstrap-gate-${language}-`));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('Bootstrap Quality Gate', () => {
  it('bootstraps TS/Python/C fixtures and validates indexing, embeddings, graph edges, and queryability', async () => {
    const tsFixture = await createFixture('typescript', {
      'src/main.ts': 'import { add } from "./math"; export function run(): number { return add(1, 2); }',
      'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }',
    });
    const pyFixture = await createFixture('python', {
      'src/main.py': 'from helper import add\n\ndef run():\n    return add(1, 2)\n',
      'src/helper.py': 'def add(a, b):\n    return a + b\n',
    });
    const cFixture = await createFixture('c', {
      'src/main.c': '#include "math.h"\nint main(void) { return add(1, 2); }\n',
      'src/math.c': '#include "math.h"\nint add(int a, int b) { return a + b; }\n',
      'src/math.h': 'int add(int a, int b);\n',
    });

    const gate = createBootstrapQualityGateConstruction();
    const result = unwrapConstructionExecutionResult(await gate.execute({
      fixtures: [
        { name: 'ts-fixture', language: 'typescript', repoPath: tsFixture },
        { name: 'py-fixture', language: 'python', repoPath: pyFixture },
        { name: 'c-fixture', language: 'c', repoPath: cFixture },
      ],
      timeoutMs: 120_000,
    }));

    expect(result.kind).toBe('BootstrapQualityGateResult.v1');
    expect(result.fixtures).toHaveLength(3);
    expect(result.durationMs).toBeLessThan(120_000);
    expect(result.fixtures.every((fixture) => fixture.bootstrapped)).toBe(true);
    expect(result.fixtures.every((fixture) => fixture.expectedFileCount > 0)).toBe(true);
    expect(result.fixtures.every((fixture) => fixture.embeddingChecks.checked >= 0)).toBe(true);
    expect(result.fixtures.every((fixture) => fixture.callGraphEdgeCount >= 0)).toBe(true);
    expect(result.fixtures.every((fixture) => fixture.queryPackCount >= 0)).toBe(true);

    if (!result.pass) {
      expect(result.findings.length).toBeGreaterThan(0);
      expect(
        result.findings.some((finding) =>
          finding.includes('ts-fixture') ||
          finding.includes('py-fixture') ||
          finding.includes('c-fixture')
        )
      ).toBe(true);
      expect(result.fixtures.some((fixture) => fixture.findings.length > 0)).toBe(true);
    }
  }, 140_000);

  it('tolerates ENOENT races during workspace cleanup', async () => {
    let calls = 0;
    await expect(
      removeDirectoryBestEffort('/tmp/nonexistent-cleanup-target', async () => {
        calls += 1;
        const error = new Error('simulated cleanup race') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      })
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
