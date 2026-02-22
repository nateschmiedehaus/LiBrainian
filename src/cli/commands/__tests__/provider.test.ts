import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getAllProviderStatusMock = vi.hoisted(() => vi.fn());
const loadQuerySessionMock = vi.hoisted(() => vi.fn());
const saveQuerySessionMock = vi.hoisted(() => vi.fn());
const resolveDbPathMock = vi.hoisted(() => vi.fn());
const createSqliteStorageMock = vi.hoisted(() => vi.fn());

const probes = [
  {
    descriptor: {
      id: 'claude',
      name: 'Claude CLI',
      defaultModel: 'claude-sonnet-4-5-20241022',
      priority: 10,
    },
  },
  {
    descriptor: {
      id: 'codex',
      name: 'Codex CLI',
      defaultModel: 'gpt-5-codex',
      priority: 20,
    },
  },
];

vi.mock('../../../api/llm_provider_discovery.js', () => ({
  getAllProviderStatus: getAllProviderStatusMock,
  llmProviderRegistry: {
    getAllProbes: () => probes,
    getProbe: (providerId: string) => probes.find((probe) => probe.descriptor.id === providerId),
  },
}));

vi.mock('../../query_sessions.js', () => ({
  loadQuerySession: loadQuerySessionMock,
  saveQuerySession: saveQuerySessionMock,
}));

vi.mock('../../db_path.js', () => ({
  resolveDbPath: resolveDbPathMock,
}));

vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: createSqliteStorageMock,
}));

describe('providerCommand', () => {
  const previousEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn>;
  let state = new Map<string, string>();
  let setStateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    state = new Map<string, string>();
    setStateMock = vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    });
    resolveDbPathMock.mockResolvedValue('/tmp/librarian.sqlite');
    createSqliteStorageMock.mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn(async (key: string) => state.get(key) ?? null),
      setState: setStateMock,
    });
    getAllProviderStatusMock.mockResolvedValue([
      {
        descriptor: probes[0].descriptor,
        status: { available: true, authenticated: true },
      },
      {
        descriptor: probes[1].descriptor,
        status: { available: true, authenticated: true },
      },
    ]);
    loadQuerySessionMock.mockResolvedValue(null);
    saveQuerySessionMock.mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.LIBRARIAN_LLM_MODEL;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env = { ...previousEnv };
  });

  it('lists registered providers in JSON mode', async () => {
    const { providerCommand } = await import('../provider.js');
    await providerCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['provider', 'list', '--json'],
    });

    const jsonOutput = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}') as {
      providers?: Array<{ id: string }>;
      current?: { provider?: string | null };
    };
    expect(parsed.providers?.map((provider) => provider.id)).toEqual(['claude', 'codex']);
    expect(parsed.current?.provider).toBe('claude');
  });

  it('persists user-default provider selection with provider use', async () => {
    const { providerCommand } = await import('../provider.js');
    await providerCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['provider', 'use', 'codex', '--model', 'gpt-5-codex', '--json'],
    });

    expect(setStateMock).toHaveBeenCalledTimes(1);
    const [stateKey, rawValue] = setStateMock.mock.calls[0] as [string, string];
    expect(stateKey).toBe('librarian.llm_user_defaults.v1');
    const parsed = JSON.parse(rawValue) as { provider?: string; modelId?: string };
    expect(parsed.provider).toBe('codex');
    expect(parsed.modelId).toBe('gpt-5-codex');
    expect(process.env.LIBRARIAN_LLM_PROVIDER).toBe('codex');
    expect(process.env.LIBRARIAN_LLM_MODEL).toBe('gpt-5-codex');

    const jsonOutput = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
    const payload = JSON.parse(jsonOutput ?? '{}') as { scope?: string };
    expect(payload.scope).toBe('user_default');
  });

  it('writes session-scoped provider selection when --session is supplied', async () => {
    const { providerCommand } = await import('../provider.js');
    loadQuerySessionMock.mockResolvedValue({
      sessionId: 'sess_provider',
      initialQuery: { intent: 'x', depth: 'L1' },
      context: { packs: [], exploredEntities: [], qaHistory: [] },
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    });

    await providerCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['provider', 'use', 'claude', '--session', 'sess_provider', '--json'],
    });

    expect(saveQuerySessionMock).toHaveBeenCalledTimes(1);
    const session = saveQuerySessionMock.mock.calls[0]?.[1] as { llmSelection?: { provider?: string; modelId?: string } };
    expect(session.llmSelection?.provider).toBe('claude');
    expect(session.llmSelection?.modelId).toBe('claude-sonnet-4-5-20241022');
    expect(setStateMock).not.toHaveBeenCalled();
  });

  it('reports session override as current selection', async () => {
    const { providerCommand } = await import('../provider.js');
    loadQuerySessionMock.mockResolvedValue({
      sessionId: 'sess_current',
      initialQuery: { intent: 'x', depth: 'L1' },
      llmSelection: {
        provider: 'codex',
        modelId: 'gpt-5-codex',
        updatedAt: new Date().toISOString(),
      },
      context: { packs: [], exploredEntities: [], qaHistory: [] },
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    });

    await providerCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['provider', 'current', '--session', 'sess_current', '--json'],
    });

    const jsonOutput = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
    const payload = JSON.parse(jsonOutput ?? '{}') as { current?: { provider?: string; source?: string } };
    expect(payload.current?.provider).toBe('codex');
    expect(payload.current?.source).toBe('session');
  });
});
