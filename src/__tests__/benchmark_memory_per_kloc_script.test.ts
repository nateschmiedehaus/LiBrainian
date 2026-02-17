import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('benchmark-memory-per-kloc script', () => {
  it('counts LOC for non-TypeScript files and emits benchmark counters', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librarian-benchmark-script-'));
    const srcDir = path.join(workspace, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, 'main.ts'), 'const a = 1;\nexport const b = a + 1;', 'utf8');
    await writeFile(path.join(srcDir, 'util.py'), 'def add(a, b):\n    return a + b', 'utf8');

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'benchmark-memory-per-kloc.ts');
    const result = spawnSync(
      process.execPath,
      ['--expose-gc', '--import', 'tsx', scriptPath, srcDir],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    await rm(workspace, { recursive: true, force: true });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const payload = JSON.parse((result.stdout ?? '').trim()) as {
      locCount?: number;
      fileCount?: number;
      parsedFileCount?: number;
      parseErrorCount?: number;
    };
    expect(payload.locCount).toBe(4);
    expect(payload.fileCount).toBe(2);
    expect(typeof payload.parsedFileCount).toBe('number');
    expect(typeof payload.parseErrorCount).toBe('number');
    expect((payload.parsedFileCount ?? 0) + (payload.parseErrorCount ?? 0)).toBe(payload.fileCount);
  });
});
