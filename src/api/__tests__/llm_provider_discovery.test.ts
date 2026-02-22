import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const manifestState = vi.hoisted(() => ({
  requireHashVerification: true,
  hashes: {
    claude: [] as string[],
    codex: [] as string[],
  },
}));

vi.mock('../cli_hash_manifest.js', () => ({
  CLI_BINARY_HASHES: manifestState,
}));

import {
  claudeCliProbe,
  codexCliProbe,
  llmProviderRegistry,
  discoverLlmProvider,
  getAllProviderStatus,
  type LlmProviderProbe,
} from '../llm_provider_discovery.js';
import { execa } from 'execa';

vi.mock('execa', () => ({ execa: vi.fn() }));

const savedProbes = new Map<string, LlmProviderProbe>();
const cleanupTasks: Array<() => void> = [];
const envSnapshot = { ...process.env };
const execaMock = vi.mocked(execa);
const TEST_MAX_CLI_BINARY_BYTES = 50 * 1024 * 1024;

function buildExecaResult(options: { exitCode: number; stdout?: string; stderr?: string }) {
  return {
    exitCode: options.exitCode,
    stdout: Buffer.from(options.stdout ?? ''),
    stderr: Buffer.from(options.stderr ?? ''),
    isCanceled: false,
  } as unknown as Awaited<ReturnType<typeof execa>>;
}

function setupVerifiedCli(
  command: 'claude' | 'codex',
  options: { mode?: number; setuid?: boolean; sizeBytes?: number; skipManifest?: boolean } = {}
): { binPath: string } {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), `llm-cli-${command}-`));
  const binDir = path.join(homeDir, '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const binPath = path.join(binDir, command);
  const mode = options.mode ?? 0o700;
  fs.writeFileSync(binPath, '#!/bin/sh\nexit 0\n', { mode });
  fs.chmodSync(binPath, options.setuid ? mode | 0o4000 : mode);
  if (options.sizeBytes !== undefined) {
    fs.truncateSync(binPath, options.sizeBytes);
  }
  if (!options.skipManifest) {
    const hash = createHash('sha256').update(fs.readFileSync(binPath)).digest('hex');
    manifestState.hashes[command].push(hash);
  }
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.HOME = homeDir;
  const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
  cleanupTasks.push(() => {
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });
  return { binPath };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

beforeEach(() => {
  for (const probe of llmProviderRegistry.getAllProbes()) {
    savedProbes.set(probe.descriptor.id, probe);
    llmProviderRegistry.unregister(probe.descriptor.id);
  }
  manifestState.hashes.claude.length = 0;
  manifestState.hashes.codex.length = 0;
  execaMock.mockReset();
  restoreEnv(envSnapshot);
});

afterEach(() => {
  while (cleanupTasks.length) {
    cleanupTasks.pop()?.();
  }
  for (const probe of llmProviderRegistry.getAllProbes()) {
    llmProviderRegistry.unregister(probe.descriptor.id);
  }
  for (const probe of savedProbes.values()) {
    llmProviderRegistry.register(probe);
  }
  savedProbes.clear();
  restoreEnv(envSnapshot);
});

describe('llm provider discovery', () => {
  it('selects the highest priority authenticated provider', async () => {
    const fastProbe: LlmProviderProbe = {
      descriptor: {
        id: 'fast',
        name: 'Fast Provider',
        authMethod: 'cli_login',
        defaultModel: 'fast-model',
        priority: 5,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({ available: true, authenticated: true }),
    };
    const slowProbe: LlmProviderProbe = {
      descriptor: {
        id: 'slow',
        name: 'Slow Provider',
        authMethod: 'cli_login',
        defaultModel: 'slow-model',
        priority: 10,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({ available: true, authenticated: true }),
    };

    llmProviderRegistry.register(slowProbe);
    llmProviderRegistry.register(fastProbe);

    const discovered = await discoverLlmProvider({ forceRefresh: true });
    expect(discovered?.provider).toBe('fast');
    expect(discovered?.modelId).toBe('fast-model');
  });

  it('returns null when no providers are available', async () => {
    const probe: LlmProviderProbe = {
      descriptor: {
        id: 'offline',
        name: 'Offline Provider',
        authMethod: 'cli_login',
        defaultModel: 'offline-model',
        priority: 5,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({ available: false, authenticated: false, error: 'missing' }),
    };
    llmProviderRegistry.register(probe);

    const discovered = await discoverLlmProvider({ forceRefresh: true });
    expect(discovered).toBeNull();
  });

  it('prioritizes preferred providers over static priority when healthy', async () => {
    const claudeProbe: LlmProviderProbe = {
      descriptor: {
        id: 'claude',
        name: 'Claude Provider',
        authMethod: 'cli_login',
        defaultModel: 'claude-model',
        priority: 10,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({ available: true, authenticated: true }),
    };
    const codexProbe: LlmProviderProbe = {
      descriptor: {
        id: 'codex',
        name: 'Codex Provider',
        authMethod: 'cli_login',
        defaultModel: 'codex-model',
        priority: 20,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({ available: true, authenticated: true }),
    };
    llmProviderRegistry.register(claudeProbe);
    llmProviderRegistry.register(codexProbe);

    const discovered = await discoverLlmProvider({
      forceRefresh: true,
      preferredProviders: ['codex'],
    });
    expect(discovered?.provider).toBe('codex');
    expect(discovered?.modelId).toBe('codex-model');
  });

  it('exposes provider status snapshots', async () => {
    const probe: LlmProviderProbe = {
      descriptor: {
        id: 'snapshot',
        name: 'Snapshot Provider',
        authMethod: 'cli_login',
        defaultModel: 'snapshot-model',
        priority: 5,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({ available: true, authenticated: false, error: 'auth missing' }),
    };
    llmProviderRegistry.register(probe);

    const statuses = await getAllProviderStatus({ forceRefresh: true });
    const status = statuses.find((entry) => entry.descriptor.id === 'snapshot');
    expect(status?.status.available).toBe(true);
    expect(status?.status.authenticated).toBe(false);
  });

  it('redacts sensitive metadata values', async () => {
    const redactedToken = ['sk', '-', '1234567890abcdef'].join('');
    const probe: LlmProviderProbe = {
      descriptor: {
        id: 'redact',
        name: 'Redact Provider',
        authMethod: 'cli_login',
        defaultModel: 'redact-model',
        priority: 5,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({
        available: true,
        authenticated: true,
        metadata: {
          description: redactedToken,
          safe: 'ok',
        },
      }),
    };
    llmProviderRegistry.register(probe);

    const statuses = await getAllProviderStatus({ forceRefresh: true });
    const status = statuses.find((entry) => entry.descriptor.id === 'redact');
    expect(status?.status.metadata).toEqual({ safe: 'ok' });
  });

  it('redacts confusable sensitive metadata values', async () => {
    const confusable = '\u0455\u043A-1234567890abcdef';
    const probe: LlmProviderProbe = {
      descriptor: {
        id: 'confusable',
        name: 'Confusable Provider',
        authMethod: 'cli_login',
        defaultModel: 'confusable-model',
        priority: 5,
        supportsEmbeddings: false,
        supportsChat: true,
      },
      envVars: [],
      probe: async () => ({
        available: true,
        authenticated: true,
        metadata: {
          description: confusable,
          safe: 'ok',
        },
      }),
    };
    llmProviderRegistry.register(probe);

    const statuses = await getAllProviderStatus({ forceRefresh: true });
    const status = statuses.find((entry) => entry.descriptor.id === 'confusable');
    expect(status?.status.metadata).toEqual({ safe: 'ok' });
  });

  it('detects Claude CLI without config as unauthenticated', async () => {
    setupVerifiedCli('claude');
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude';
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'claude 1.0.0' }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(true);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('Claude CLI not authenticated');

    existsSyncSpy.mockRestore();
  });

  it('detects Claude CLI missing binary', async () => {
    process.env.PATH = '';
    const homedirSpy = vi.spyOn(os, 'homedir').mockImplementation(() => {
      throw new Error('no home');
    });
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 1, stderr: 'not found' }));

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('cli_binary_not_found');
    homedirSpy.mockRestore();
  });

  it('detects Claude CLI authenticated when config exists', async () => {
    setupVerifiedCli('claude');
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude';
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'claude 1.0.0' }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(true);
    expect(status.authenticated).toBe(true);

    existsSyncSpy.mockRestore();
  });

  it('detects Codex CLI missing home as unauthenticated', async () => {
    setupVerifiedCli('codex');
    process.env.CODEX_HOME = '/tmp/codex';
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'codex 1.0.0' }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const status = await codexCliProbe.probe();
    expect(status.available).toBe(true);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('CODEX_HOME directory not found');

    existsSyncSpy.mockRestore();
  });

  it('detects Codex CLI unauthenticated from login status', async () => {
    setupVerifiedCli('codex');
    process.env.CODEX_HOME = '/tmp/codex';
    execaMock
      .mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'codex 1.0.0' }))
      .mockResolvedValueOnce(buildExecaResult({ exitCode: 1, stdout: 'not logged in' }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const status = await codexCliProbe.probe();
    expect(status.available).toBe(true);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('not logged in');

    existsSyncSpy.mockRestore();
  });

  it('detects Codex CLI authenticated from login status', async () => {
    setupVerifiedCli('codex');
    process.env.CODEX_HOME = '/tmp/codex';
    execaMock
      .mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'codex 1.0.0' }))
      .mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'Logged in' }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const status = await codexCliProbe.probe();
    expect(status.available).toBe(true);
    expect(status.authenticated).toBe(true);

    existsSyncSpy.mockRestore();
  });

  it('treats empty Codex login status as unauthenticated', async () => {
    setupVerifiedCli('codex');
    process.env.CODEX_HOME = '/tmp/codex';
    execaMock
      .mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'codex 1.0.0' }))
      .mockResolvedValueOnce(buildExecaResult({ exitCode: 0 }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const status = await codexCliProbe.probe();
    expect(status.available).toBe(true);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('Codex CLI not authenticated');

    existsSyncSpy.mockRestore();
  });

  it('only forwards allowlisted env vars to CLI checks', async () => {
    setupVerifiedCli('claude');
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude';
    process.env.CODEX_HOME = '/tmp/codex';
    process.env.XDG_CONFIG_HOME = '/tmp/xdg';
    process.env.CODEX_API_KEY = 'supersecret';
    process.env.CLAUDE_TOKEN = 'nope';
    process.env.WAVE0_TEST = 'nope';
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 1, stderr: 'not found' }));
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await claudeCliProbe.probe();
    const call = execaMock.mock.calls[0] as unknown as [string, string[], { env?: NodeJS.ProcessEnv }];
    const env = call?.[2]?.env;
    expect(env?.CLAUDE_CONFIG_DIR).toBe('/tmp/claude');
    expect(env?.CODEX_HOME).toBe('/tmp/codex');
    expect(env?.XDG_CONFIG_HOME).toBe('/tmp/xdg');
    expect(env?.CODEX_API_KEY).toBeUndefined();
    expect(env?.CLAUDE_TOKEN).toBeUndefined();
    expect(env?.WAVE0_TEST).toBeUndefined();

    existsSyncSpy.mockRestore();
  });

  it('handles homedir errors for Claude config resolution', async () => {
    process.env.PATH = '';
    const homedirSpy = vi.spyOn(os, 'homedir').mockImplementation(() => {
      throw new Error('no home');
    });

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('cli_binary_not_found');

    homedirSpy.mockRestore();
  });

  it('handles homedir errors for Codex home resolution', async () => {
    process.env.PATH = '';
    const homedirSpy = vi.spyOn(os, 'homedir').mockImplementation(() => {
      throw new Error('no home');
    });

    const status = await codexCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain('cli_binary_not_found');

    homedirSpy.mockRestore();
  });

  it('rejects group-writable CLI binaries', async () => {
    setupVerifiedCli('claude', { mode: 0o770 });
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'claude 1.0.0' }));

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.error).toContain('cli_binary_permissions_unsafe');
  });

  it('rejects setuid CLI binaries', async () => {
    const { binPath } = setupVerifiedCli('claude');
    const binRealPath = fs.realpathSync(binPath);
    const realStatSync = fs.statSync;
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation((pathLike) => {
      const stats = realStatSync(pathLike as string);
      if (pathLike === binPath || pathLike === binRealPath) {
        const clone = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats);
        clone.mode = stats.mode | 0o4000;
        return clone;
      }
      return stats;
    });
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'claude 1.0.0' }));

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.error).toContain('cli_binary_privileged');

    statSpy.mockRestore();
  });

  it('rejects PATH traversal segments', async () => {
    process.env.PATH = '/tmp/../bin';
    const homedirSpy = vi.spyOn(os, 'homedir').mockImplementation(() => {
      throw new Error('no home');
    });

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.error).toContain('cli_binary_not_found');
    expect(status.error).toContain('path_invalid');

    homedirSpy.mockRestore();
  });

  it('rejects oversized CLI binaries before hashing', async () => {
    setupVerifiedCli('claude', {
      sizeBytes: TEST_MAX_CLI_BINARY_BYTES + 1,
      skipManifest: true,
    });
    manifestState.hashes.claude.push('0'.repeat(64));
    execaMock.mockResolvedValueOnce(buildExecaResult({ exitCode: 0, stdout: 'claude 1.0.0' }));

    const status = await claudeCliProbe.probe();
    expect(status.available).toBe(false);
    expect(status.error).toContain('cli_hash_too_large');
  });
});
