import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const createdDirs: string[] = [];

async function createStubWorkspace(stubBody: string): Promise<{ workspace: string; callLogPath: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-quality-analysis-'));
  createdDirs.push(workspace);
  await fs.mkdir(path.join(workspace, 'dist', 'cli'), { recursive: true });
  const callLogPath = path.join(workspace, 'call-log.jsonl');
  const stubPath = path.join(workspace, 'dist', 'cli', 'index.js');
  await fs.writeFile(stubPath, stubBody, 'utf8');
  return { workspace, callLogPath };
}

async function runAnalysisScript(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string }> {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'issue-quality-analysis.mjs');
  return await execFileAsync('node', [scriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      ...env,
    },
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function readArtifact(workspace: string, issueNumber: number): Promise<any> {
  const artifactPath = path.join(workspace, 'state', 'issue-analyses', `issue-${issueNumber}-analysis.json`);
  return JSON.parse(await fs.readFile(artifactPath, 'utf8'));
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('issue-quality-analysis script', () => {
  it('runs user-specified queries even when non-sensitive auto-detection is false', async () => {
    const { workspace, callLogPath } = await createStubWorkspace(`
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.CALL_LOG_PATH) {
  fs.appendFileSync(process.env.CALL_LOG_PATH, JSON.stringify(args) + '\\n');
}
process.stdout.write(JSON.stringify({ packs: [{ files: ['src/focused.ts'] }] }));
`);

    const { stdout } = await runAnalysisScript([
      '12345',
      '--description', 'fix readme typo',
      '--queries', 'Where is focused logic implemented?',
      '--workspace', workspace,
      '--query-timeout-ms', '5000',
      '--verdict', 'improved',
      '--assessment', 'forced query execution works',
    ], {
      CALL_LOG_PATH: callLogPath,
    });

    expect(stdout).toContain('Running user-specified queries despite non-sensitive auto-detection.');
    const artifact = await readArtifact(workspace, 12345);
    expect(artifact.quality_sensitive).toBe(false);
    expect(artifact.queries_run).toHaveLength(1);
    expect(artifact.queries_run[0].success).toBe(true);
    expect(artifact.evidence_quality).toBe('live_queries_ok');
  });

  it('retries timed-out no-bootstrap query without --no-bootstrap', async () => {
    const { workspace, callLogPath } = await createStubWorkspace(`
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.CALL_LOG_PATH) {
  fs.appendFileSync(process.env.CALL_LOG_PATH, JSON.stringify(args) + '\\n');
}
if (args.includes('--no-bootstrap')) {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ packs: [{ files: ['src/late.ts'] }] }));
    process.exit(0);
  }, 5000);
} else {
  process.stdout.write(JSON.stringify({ packs: [{ files: ['src/recovered.ts'] }] }));
}
`);

    await runAnalysisScript([
      '809',
      '--description', 'retrieval quality fix for timeout handling',
      '--queries', 'Where is query synthesis executed?',
      '--workspace', workspace,
      '--query-timeout-ms', '200',
      '--verdict', 'improved',
      '--assessment', 'retry succeeded',
    ], {
      CALL_LOG_PATH: callLogPath,
    });

    const artifact = await readArtifact(workspace, 809);
    expect(artifact.queries_run).toHaveLength(1);
    expect(artifact.queries_run[0].success).toBe(true);
    expect(artifact.queries_run[0].timed_out).toBe(false);
    expect(artifact.evidence_quality).toBe('live_queries_ok');

    const callLogRaw = await fs.readFile(callLogPath, 'utf8');
    const calls = callLogRaw.trim().split('\n').map((line) => JSON.parse(line) as string[]);
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('--no-bootstrap');
    expect(calls[1]).not.toContain('--no-bootstrap');
  });

  it('classifies runtime abort failures in the artifact', async () => {
    const { workspace } = await createStubWorkspace(`
console.error('libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed: Invalid argument');
process.exit(1);
`);

    await runAnalysisScript([
      '897',
      '--description', 'retrieval runtime abort investigation',
      '--queries', 'Where is query synthesis executed?',
      '--workspace', workspace,
      '--query-timeout-ms', '1000',
      '--verdict', 'insufficient_evidence',
      '--assessment', 'runtime abort reproduced',
    ]);

    const artifact = await readArtifact(workspace, 897);
    expect(artifact.queries_run).toHaveLength(1);
    expect(artifact.queries_run[0].success).toBe(false);
    expect(artifact.queries_run[0].failure_class).toBe('runtime_abort');
    expect(artifact.evidence_quality).toBe('failed_live_queries');
  });
});

