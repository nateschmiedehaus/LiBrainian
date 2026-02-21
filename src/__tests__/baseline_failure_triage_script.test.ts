import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type JsonObject = Record<string, unknown>;

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

describe('baseline failure triage script', () => {
  it('exits with must_fix_now when failure is in scope', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librainian-baseline-triage-'));
    const logPath = path.join(workspace, 'run.log');
    const artifactPath = path.join(workspace, 'triage.json');
    const markdownPath = path.join(workspace, 'triage.md');

    await writeText(logPath, ' FAIL  src/mcp/__tests__/schema.test.ts > schema coverage > exports all tools\nAssertionError: expected 3 to be 4\n');

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'baseline-failure-triage.ts');
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(process.cwd(), 'scripts', 'run-with-tmpdir.mjs'),
        '--',
        'tsx',
        scriptPath,
        '--log',
        logPath,
        '--artifact',
        artifactPath,
        '--markdown',
        markdownPath,
        '--no-scope-from-git',
        '--scope',
        'src/mcp/__tests__/schema.test.ts',
        '--no-create-gh-issues',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status).toBe(2);
    const payload = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonObject;
    const summary = payload.summary as JsonObject;
    expect(summary.mustFixNow).toBe(1);
    expect(summary.deferNonScope).toBe(0);

    await rm(workspace, { recursive: true, force: true });
  });

  it('fails closed when defer_non_scope cannot be tracked with gh issue creation', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librainian-baseline-triage-defer-'));
    const logPath = path.join(workspace, 'run.log');
    const artifactPath = path.join(workspace, 'triage.json');

    await writeText(logPath, 'src/mcp/server.ts(42,5): error TS2304: Cannot find name \'foo\'.\n');

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'baseline-failure-triage.ts');
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(process.cwd(), 'scripts', 'run-with-tmpdir.mjs'),
        '--',
        'tsx',
        scriptPath,
        '--log',
        logPath,
        '--artifact',
        artifactPath,
        '--no-scope-from-git',
        '--scope',
        'src/api/query.ts',
        '--no-create-gh-issues',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status).toBe(3);
    const payload = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonObject;
    const summary = payload.summary as JsonObject;
    const issueActions = payload.issueActions as JsonObject[];

    expect(summary.mustFixNow).toBe(0);
    expect(summary.deferNonScope).toBe(1);
    expect(issueActions[0]?.action).toBe('skipped');

    await rm(workspace, { recursive: true, force: true });
  });
});
