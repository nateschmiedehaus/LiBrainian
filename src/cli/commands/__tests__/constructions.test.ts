import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { constructionsCommand } from '../constructions.js';
import { invokeConstruction } from '../../../constructions/registry.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

vi.mock('../../../api/librarian.js', () => ({
  Librarian: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../constructions/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../constructions/registry.js')>();
  return {
    ...actual,
    invokeConstruction: vi.fn(async () => ({ ok: true })),
  };
});

describe('constructionsCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const workspaces: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (spawnSync as unknown as Mock).mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    while (workspaces.length > 0) {
      const workspace = workspaces.pop();
      if (workspace) {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  });

  it('lists constructions in JSON mode with trust-tier groups', async () => {
    await constructionsCommand({
      workspace: '/tmp/workspace',
      args: ['list'],
      rawArgs: ['constructions', 'list', '--json'],
    });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.command).toBe('list');
    expect(typeof payload.total).toBe('number');
    expect((payload.total as number)).toBeGreaterThan(0);
    expect((payload.groups as Record<string, unknown>)?.official).toBeTruthy();
  });

  it('returns ranked search results in JSON mode', async () => {
    await constructionsCommand({
      workspace: '/tmp/workspace',
      args: ['search', 'security', 'audit'],
      rawArgs: ['constructions', 'search', 'security', 'audit', '--json'],
    });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<{ score: number; id: string }>;
    };
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0]?.score ?? 0).toBeGreaterThan(0);
    expect(payload.results.some((result) => result.id.includes('security-audit-helper'))).toBe(true);
    const security = payload.results.find((result) => result.id === 'librainian:security-audit-helper') as
      | (typeof payload.results[number] & { installCommand?: string })
      | undefined;
    expect(security?.installCommand).toBe('librarian constructions install librainian:security-audit-helper');
    for (let index = 1; index < payload.results.length; index += 1) {
      expect(payload.results[index - 1]!.score).toBeGreaterThanOrEqual(payload.results[index]!.score);
    }
  });

  it('describes a construction with install command in JSON mode', async () => {
    await constructionsCommand({
      workspace: '/tmp/workspace',
      args: ['describe', 'librainian:security-audit-helper'],
      rawArgs: ['constructions', 'describe', 'librainian:security-audit-helper', '--json'],
    });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.id).toBe('librainian:security-audit-helper');
    expect(typeof payload.agentDescription).toBe('string');
    expect(payload.installMode).toBe('builtin');
    expect(payload.installCommand).toBe('librarian constructions install librainian:security-audit-helper');
    expect(typeof payload.runCommand).toBe('string');
    expect((payload.requiredCapabilities as string[]).includes('security-analysis')).toBe(true);
  });

  it('validates a manifest and reports actionable errors', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librainian-constructions-'));
    workspaces.push(workspace);
    const manifestPath = path.join(workspace, 'construction.manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      id: 'librainian:security-audit-helper',
      version: 'nope',
      inputSchema: {},
      outputSchema: {},
      requiredCapabilities: ['made-up-capability'],
    }, null, 2));

    await constructionsCommand({
      workspace,
      args: ['validate', manifestPath],
      rawArgs: ['constructions', 'validate', manifestPath, '--json'],
    });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      valid: boolean;
      errors: string[];
      warnings: string[];
    };
    expect(payload.valid).toBe(false);
    expect(payload.errors.some((line) => line.includes('already registered'))).toBe(true);
    expect(payload.errors.some((line) => line.includes('version'))).toBe(true);
    expect(payload.errors.some((line) => line.includes('requiredCapabilities'))).toBe(true);
    expect(payload.warnings.some((line) => line.includes('agentDescription'))).toBe(true);
  });

  it('supports install dry-run and install execution for built-in constructions without npm', async () => {
    await constructionsCommand({
      workspace: '/tmp/workspace',
      args: ['install', 'librainian:security-audit-helper'],
      rawArgs: ['constructions', 'install', 'librainian:security-audit-helper', '--dry-run', '--json'],
    });

    let payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.dryRun).toBe(true);
    expect(payload.installMode).toBe('builtin');
    expect(spawnSync).not.toHaveBeenCalled();

    logSpy.mockClear();
    await constructionsCommand({
      workspace: '/tmp/workspace',
      args: ['install', 'librainian:security-audit-helper'],
      rawArgs: ['constructions', 'install', 'librainian:security-audit-helper', '--json'],
    });

    payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.installMode).toBe('builtin');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('runs a built-in construction via the run subcommand', async () => {
    await constructionsCommand({
      workspace: '/tmp/workspace',
      args: ['run', 'librainian:security-audit-helper'],
      rawArgs: ['constructions', 'run', 'librainian:security-audit-helper', '--input', '{"files":["src/auth.ts"],"checkTypes":["auth"]}', '--json'],
    });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.id).toBe('librainian:security-audit-helper');
    expect(invokeConstruction).toHaveBeenCalled();
  });
});
