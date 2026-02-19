import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { installOpenclawSkillCommand } from '../install_openclaw_skill.js';

describe('installOpenclawSkillCommand', () => {
  let homeDir: string;
  let workspace: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let priorHome: string | undefined;

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), 'librainian-openclaw-home-'));
    workspace = await mkdtemp(path.join(tmpdir(), 'librainian-openclaw-ws-'));
    priorHome = process.env.HOME;
    process.env.HOME = homeDir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (priorHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = priorHome;
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it('installs skill, updates OpenClaw config, and emits JSON report', async () => {
    await installOpenclawSkillCommand({
      workspace,
      args: [],
      rawArgs: ['install-openclaw-skill', '--json'],
    });

    const openclawRoot = path.join(homeDir, '.openclaw');
    const skillPath = path.join(openclawRoot, 'skills', 'librainian', 'SKILL.md');
    const configPath = path.join(openclawRoot, 'openclaw.json');
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const skillMd = await readFile(skillPath, 'utf8');
    expect(skillMd).toContain('name: librainian');
    expect(skillMd).toContain('get_context_pack');

    const parsedConfig = JSON.parse(await readFile(configPath, 'utf8')) as {
      skills?: {
        entries?: Record<string, { enabled?: boolean; config?: { mcpTools?: string[] } }>;
      };
    };
    expect(parsedConfig.skills?.entries?.librainian?.enabled).toBe(true);
    expect(parsedConfig.skills?.entries?.librainian?.config?.mcpTools).toContain('get_context_pack');

    const payload = logSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"skillPath"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsedPayload = JSON.parse(payload!);
    expect(parsedPayload.success).toBe(true);
    expect(parsedPayload.mcpReachable).toBe(true);
  });

  it('supports dry-run without writing files', async () => {
    await installOpenclawSkillCommand({
      workspace,
      args: [],
      rawArgs: ['install-openclaw-skill', '--dry-run', '--json'],
    });

    const openclawRoot = path.join(homeDir, '.openclaw');
    const skillPath = path.join(openclawRoot, 'skills', 'librainian', 'SKILL.md');
    const configPath = path.join(openclawRoot, 'openclaw.json');
    expect(existsSync(skillPath)).toBe(false);
    expect(existsSync(configPath)).toBe(false);

    const payload = logSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"dryRun"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsedPayload = JSON.parse(payload!);
    expect(parsedPayload.dryRun).toBe(true);
    expect(parsedPayload.success).toBe(true);
  });

  it('merges into existing JSON5-style OpenClaw config', async () => {
    const openclawRoot = path.join(homeDir, '.openclaw');
    const configPath = path.join(openclawRoot, 'openclaw.json');
    await mkdir(openclawRoot, { recursive: true });
    await writeFile(
      configPath,
      `{
  // Existing settings
  skills: {
    entries: {
      existingSkill: { enabled: false },
    },
  },
}
`,
      'utf8',
    );

    await installOpenclawSkillCommand({
      workspace,
      args: [],
      rawArgs: ['install-openclaw-skill'],
    });

    const parsedConfig = JSON.parse(await readFile(configPath, 'utf8')) as {
      skills?: {
        entries?: Record<string, { enabled?: boolean }>;
      };
    };
    expect(parsedConfig.skills?.entries?.existingSkill?.enabled).toBe(false);
    expect(parsedConfig.skills?.entries?.librainian?.enabled).toBe(true);
  });
});
