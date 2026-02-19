import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { openclawDaemonCommand } from '../openclaw_daemon.js';

describe('openclawDaemonCommand', () => {
  let rootDir: string;
  let openclawRoot: string;
  let stateRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'librainian-openclaw-daemon-'));
    openclawRoot = path.join(rootDir, 'openclaw');
    stateRoot = path.join(rootDir, 'librainian-state');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('starts and writes OpenClaw registration + daemon state', async () => {
    await openclawDaemonCommand({
      workspace: rootDir,
      args: ['start'],
      rawArgs: ['openclaw-daemon', 'start', '--openclaw-root', openclawRoot, '--state-root', stateRoot, '--json'],
    });

    const configPath = path.join(openclawRoot, 'config.yaml');
    const statePath = path.join(stateRoot, 'state.json');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(statePath)).toBe(true);

    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('backgroundServices:');
    expect(config).toContain('name: librainian');

    const state = JSON.parse(await readFile(statePath, 'utf8')) as { running?: boolean };
    expect(state.running).toBe(true);
  });

  it('reports daemon status and supports stop transition', async () => {
    await openclawDaemonCommand({
      workspace: rootDir,
      args: ['start'],
      rawArgs: ['openclaw-daemon', 'start', '--openclaw-root', openclawRoot, '--state-root', stateRoot],
    });

    await openclawDaemonCommand({
      workspace: rootDir,
      args: ['status'],
      rawArgs: ['openclaw-daemon', 'status', '--state-root', stateRoot, '--json'],
    });
    const statusPayload = logSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"running"')) as string | undefined;
    expect(statusPayload).toBeTruthy();
    expect(JSON.parse(statusPayload!).running).toBe(true);

    await openclawDaemonCommand({
      workspace: rootDir,
      args: ['stop'],
      rawArgs: ['openclaw-daemon', 'stop', '--state-root', stateRoot],
    });

    const statePath = path.join(stateRoot, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { running?: boolean };
    expect(state.running).toBe(false);
  });
});
