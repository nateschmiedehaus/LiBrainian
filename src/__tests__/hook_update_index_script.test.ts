import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function createNpmStub() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-update-index-test-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, 'npm');
  fs.writeFileSync(
    npmPath,
    `#!/usr/bin/env node
const exitCode = Number(process.env.STUB_NPM_EXIT_CODE ?? '0');
if (process.env.STUB_NPM_STDOUT) process.stdout.write(process.env.STUB_NPM_STDOUT);
if (process.env.STUB_NPM_STDERR) process.stderr.write(process.env.STUB_NPM_STDERR);
process.exit(exitCode);
`,
    'utf8',
  );
  fs.chmodSync(npmPath, 0o755);
  return { root, binDir };
}

function runHook(binDir: string, extraEnv: Record<string, string>) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'hook-update-index.mjs');
  return spawnSync(process.execPath, [scriptPath, 'src/index.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    timeout: 15_000,
  });
}

describe('hook-update-index script', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats adapter-registration bootstrap failures as non-blocking', () => {
    const { root, binDir } = createNpmStub();
    cleanupDirs.push(root);
    const result = runHook(binDir, {
      STUB_NPM_EXIT_CODE: '41',
      STUB_NPM_STDERR: 'EBOOTSTRAP_FAILED: Model policy provider not registered\\n',
    });

    expect(result.status).toBe(0);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
    expect(output).toContain('LiBrainian staged index update skipped (non-blocking:adapter_unavailable)');
    expect(output).toContain('npx tsx src/cli/index.ts bootstrap');
    expect(output).toContain('EBOOTSTRAP_FAILED');
  });

  it('treats unverified llm adapter unregistered failures as non-blocking', () => {
    const { root, binDir } = createNpmStub();
    cleanupDirs.push(root);
    const result = runHook(binDir, {
      STUB_NPM_EXIT_CODE: '41',
      STUB_NPM_STDERR: 'unverified_by_trace(llm_adapter_unregistered): Call registerLlmServiceAdapter() first\\n',
    });

    expect(result.status).toBe(0);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
    expect(output).toContain('LiBrainian staged index update skipped (non-blocking:adapter_unavailable)');
    expect(output).toContain('npx tsx src/cli/index.ts bootstrap');
    expect(output).toContain('llm_adapter_unregistered');
  });

  it('keeps unknown update failures blocking', () => {
    const { root, binDir } = createNpmStub();
    cleanupDirs.push(root);
    const result = runHook(binDir, {
      STUB_NPM_EXIT_CODE: '2',
      STUB_NPM_STDERR: 'unexpected_update_failure\\n',
    });

    expect(result.status).toBe(2);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
    expect(output).toContain('unexpected_update_failure');
    expect(output).not.toContain('LiBrainian staged index update skipped (non-blocking)');
  });
});
