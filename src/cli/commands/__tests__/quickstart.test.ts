import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { quickstartCommand } from '../quickstart.js';
import { resolveDbPath } from '../../db_path.js';
import { resolveWorkspaceRoot } from '../../../utils/workspace_resolver.js';
import { runOnboardingRecovery } from '../../../api/onboarding_recovery.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));
vi.mock('../../../utils/workspace_resolver.js', () => ({
  resolveWorkspaceRoot: vi.fn(),
}));
vi.mock('../../../api/onboarding_recovery.js', () => ({
  runOnboardingRecovery: vi.fn(),
}));

describe('quickstartCommand', () => {
  const workspace = '/tmp/librarian-quickstart';
  const resolvedWorkspace = '/tmp/librarian-quickstart/root';
  const dbPath = '/tmp/librarian.sqlite';
  const originalHome = process.env.HOME;

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(resolveDbPath).mockResolvedValue(dbPath);
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      workspace: resolvedWorkspace,
      changed: true,
      marker: 'package.json',
      confidence: 0.9,
    });
    vi.mocked(runOnboardingRecovery).mockResolvedValue({
      errors: [],
      configHeal: { attempted: false, success: true, appliedFixes: 0, failedFixes: 0 },
      storageRecovery: { attempted: false, recovered: false, actions: [], errors: [] },
      bootstrap: { required: false, attempted: false, success: true, retries: 0, skipEmbeddings: true, skipLlm: true },
    } as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    delete process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it('uses defaults and resolved workspace root', async () => {
    await quickstartCommand({ workspace, args: [], rawArgs: ['quickstart'] });

    expect(runOnboardingRecovery).toHaveBeenCalledWith(expect.objectContaining({
      workspace: resolvedWorkspace,
      dbPath,
      autoHealConfig: true,
      allowDegradedEmbeddings: true,
      bootstrapMode: 'fast',
      emitBaseline: true,
      updateAgentDocs: false,
      forceBootstrap: false,
      riskTolerance: 'low',
    }));
  });

  it('respects explicit flags', async () => {
    await quickstartCommand({
      workspace,
      args: [],
      rawArgs: ['quickstart', '--mode', 'full', '--risk-tolerance', 'medium', '--force', '--skip-baseline', '--update-agent-docs', '--json'],
    });

    expect(runOnboardingRecovery).toHaveBeenCalledWith(expect.objectContaining({
      bootstrapMode: 'full',
      riskTolerance: 'medium',
      forceBootstrap: true,
      emitBaseline: false,
      updateAgentDocs: true,
    }));

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"status"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.status).toBeTruthy();
  });

  it('supports setup-compatible depth/ci/no-mcp flags', async () => {
    await quickstartCommand({
      workspace,
      args: [],
      rawArgs: ['setup', '--depth', 'quick', '--ci', '--no-mcp', '--json'],
    });

    expect(runOnboardingRecovery).toHaveBeenCalledWith(expect.objectContaining({
      bootstrapMode: 'fast',
    }));

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"mcp"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.ci).toBe(true);
    expect(parsed.mcp?.skipped).toBe(true);
  });

  it('auto-configures workspace MCP files when invoked as init', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-init-quickstart-'));
    const localWorkspace = path.join(root, 'workspace');
    const localHome = path.join(root, 'home');
    await fs.mkdir(path.join(localWorkspace, '.vscode'), { recursive: true });
    await fs.mkdir(localHome, { recursive: true });
    process.env.HOME = localHome;

    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      workspace: localWorkspace,
      changed: false,
      confidence: 1,
    });

    await quickstartCommand({
      workspace: localWorkspace,
      args: [],
      rawArgs: ['init', '--editor', 'vscode', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"mcp"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.mcp?.autoConfigured).toBe(true);
    expect(parsed.mcp?.configured).toBe(true);
    expect(parsed.mcp?.actions?.some((action: { status?: string }) => action.status === 'written')).toBe(true);
    await expect(fs.readFile(path.join(localWorkspace, '.vscode', 'mcp.json'), 'utf8')).resolves.toContain('servers');
  });

  it('throws on conflicting --mode and --depth values', async () => {
    await expect(quickstartCommand({
      workspace,
      args: [],
      rawArgs: ['setup', '--mode', 'full', '--depth', 'quick'],
    })).rejects.toThrow(/Conflicting options/);
  });

  it('surfaces bootstrap warnings in JSON output', async () => {
    vi.mocked(runOnboardingRecovery).mockResolvedValue({
      errors: [],
      configHeal: { attempted: false, success: true, appliedFixes: 0, failedFixes: 0 },
      storageRecovery: { attempted: false, recovered: false, actions: [], errors: [] },
      bootstrap: {
        required: true,
        attempted: true,
        success: true,
        retries: 0,
        skipEmbeddings: false,
        skipLlm: true,
        report: { warnings: ['Semantic search unavailable - no embeddings generated.'] },
      },
    } as any);

    await quickstartCommand({
      workspace,
      args: [],
      rawArgs: ['quickstart', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"warnings"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.warnings).toContain('Semantic search unavailable - no embeddings generated.');
  });

  it('explains why capabilities are disabled when providers are available', async () => {
    vi.mocked(runOnboardingRecovery).mockResolvedValue({
      errors: [],
      configHeal: { attempted: false, success: true, appliedFixes: 0, failedFixes: 0 },
      storageRecovery: { attempted: false, recovered: false, actions: [], errors: [] },
      providerStatus: {
        llm: { available: true, provider: 'claude', model: 'claude-haiku', latencyMs: 5 },
        embedding: { available: true, provider: 'xenova', model: 'all-MiniLM', latencyMs: 5 },
      },
      bootstrap: {
        required: false,
        attempted: false,
        success: true,
        retries: 0,
        skipEmbeddings: true,
        skipLlm: true,
      },
    } as any);

    await quickstartCommand({ workspace, args: [], rawArgs: ['quickstart'] });

    const output = consoleLogSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('disabled (fast mode; provider ready)');
  });
});
