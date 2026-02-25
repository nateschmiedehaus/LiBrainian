import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function createStubScript(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-patrol-smoke-test-'));
  const scriptPath = path.join(root, 'stub.mjs');
  fs.writeFileSync(scriptPath, source, 'utf8');
  return { root, scriptPath };
}

function runScript(commandJson, timeoutMs = 2_000, heartbeatMs = 100) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'prepush-patrol-smoke.mjs');
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PREPUSH_PATROL_COMMAND_JSON: JSON.stringify(commandJson),
      PREPUSH_PATROL_TIMEOUT_MS: String(timeoutMs),
      PREPUSH_PATROL_HEARTBEAT_MS: String(heartbeatMs),
    },
    timeout: 15_000,
  });
}

describe('prepush-patrol-smoke script', () => {
  const cleanupDirs = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports bounded completion for successful patrol command', () => {
    const stub = createStubScript("console.log('stub patrol ok'); process.exit(0);\n");
    cleanupDirs.push(stub.root);
    const result = runScript([process.execPath, stub.scriptPath], 2_000, 100);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;

    expect(result.status).toBe(0);
    expect(output).toContain('[pre-push] patrol-smoke start');
    expect(output).toContain('stub patrol ok');
    expect(output).toContain('[pre-push] patrol-smoke completed');
  });

  it('keeps pre-push non-blocking and prints actionable fallback on failure', () => {
    const stub = createStubScript("console.error('stub patrol failure'); process.exit(3);\n");
    cleanupDirs.push(stub.root);
    const result = runScript([process.execPath, stub.scriptPath], 2_000, 100);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;

    expect(result.status).toBe(0);
    expect(output).toContain('[pre-push] patrol-smoke non-blocking failure');
    expect(output).toContain('stub patrol failure');
    expect(output).toContain('git push --no-verify');
  });

  it('times out stalled patrol command with explicit reason and fallback', () => {
    const stub = createStubScript("setInterval(() => {}, 1000);\n");
    cleanupDirs.push(stub.root);
    const result = runScript([process.execPath, stub.scriptPath], 200, 50);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;

    expect(result.status).toBe(0);
    expect(output).toContain('[pre-push] patrol-smoke timeout');
    expect(output).toContain('[pre-push] patrol-smoke non-blocking timeout');
    expect(output).toContain('git push --no-verify');
  });
});
