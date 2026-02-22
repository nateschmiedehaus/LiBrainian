/**
 * @fileoverview Tests for query command LLM resolution behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../api/query.js', () => ({
  queryLibrarian: vi.fn().mockResolvedValue({
    intent: 'test',
    depth: 'L1',
    totalConfidence: 0.5,
    cacheHit: false,
    latencyMs: 10,
    packs: [],
  }),
}));

vi.mock('../../../api/bootstrap.js', () => ({
  isBootstrapRequired: vi.fn().mockResolvedValue({ required: false, reason: 'ok' }),
  bootstrapProject: vi.fn().mockResolvedValue({ success: true }),
  createBootstrapConfig: vi.fn((workspace: string, overrides: Record<string, unknown> = {}) => ({
    workspace,
    include: [],
    exclude: [],
    ...overrides,
  })),
}));

vi.mock('../../../api/versioning.js', () => ({
  detectLibrarianVersion: vi.fn().mockResolvedValue({ qualityTier: 'full' }),
}));

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn().mockResolvedValue('/tmp/librarian.sqlite'),
}));

vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue({
      totalFunctions: 100,
      totalEmbeddings: 100,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../constructions/enumeration.js', () => ({
  detectEnumerationIntent: vi.fn().mockReturnValue({ isEnumeration: false, confidence: 0 }),
  shouldUseEnumerationMode: vi.fn().mockReturnValue(false),
  enumerateByCategory: vi.fn(),
  formatEnumerationResult: vi.fn(),
}));

vi.mock('../../../api/dependency_query.js', () => ({
  parseStructuralQueryIntent: vi.fn().mockReturnValue({ isStructural: false }),
  executeExhaustiveDependencyQuery: vi.fn(),
  shouldUseExhaustiveMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../progress.js', () => ({
  createSpinner: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn(), update: vi.fn() })),
  formatDuration: vi.fn((ms: number) => `${ms}ms`),
  printKeyValue: vi.fn(),
}));

vi.mock('../../../api/llm_env.js', () => ({
  resolveLibrarianModelConfigWithDiscovery: vi.fn().mockRejectedValue(new Error('no providers')),
}));

vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn().mockResolvedValue({
    llm: { available: false, provider: 'unknown', model: 'unknown' },
    embedding: { available: true, provider: 'xenova', model: 'test-embed' },
  }),
}));

describe('queryCommand LLM resolution', () => {
  const prevEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.LIBRARIAN_LLM_MODEL;
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = null;
    process.env = { ...prevEnv };
  });

  it('disables synthesis when no LLM config is available', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.llmRequirement).toBe('disabled');
    expect(process.env.LIBRARIAN_LLM_PROVIDER).toBeUndefined();
  });

  it('auto-bootstraps when required', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({ required: true, reason: 'missing' });

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    expect(bootstrapProject).toHaveBeenCalled();
    const overrides = vi.mocked(createBootstrapConfig).mock.calls[0]?.[1];
    expect(overrides?.bootstrapMode).toBe('fast');
    expect(overrides?.skipLlm).toBe(true);
  });

  it('respects --no-bootstrap', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({ required: true, reason: 'missing' });

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--no-bootstrap', '--json'],
    })).rejects.toMatchObject({ code: 'NOT_BOOTSTRAPPED' });

    expect(bootstrapProject).not.toHaveBeenCalled();
  });

  it('parses intent from command args when raw argv includes pre-command globals', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: ['hello world', '--json'],
      rawArgs: ['--workspace', '/tmp/workspace', 'query', 'hello world', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.intent).toBe('hello world');
  });

  it('preserves query flags from rawArgs when positional args are stripped', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: ['src/mcp/server.ts', 'heuristic', 'hello world'],
      rawArgs: [
        '--workspace',
        '/tmp/workspace',
        'query',
        '--files',
        'src/mcp/server.ts',
        '--strategy',
        'heuristic',
        '--json',
        'hello world',
      ],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.intent).toBe('hello world');
    expect(call?.affectedFiles).toEqual(['/tmp/workspace/src/mcp/server.ts']);
    expect(call?.embeddingRequirement).toBe('disabled');
    expect(call?.llmRequirement).toBe('disabled');
  });

  it('maps --strategy heuristic to disabled embeddings and synthesis', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--strategy', 'heuristic', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.embeddingRequirement).toBe('disabled');
    expect(call?.llmRequirement).toBe('disabled');
  });

  it('blocks --strategy semantic when embedding coverage is below threshold', async () => {
    const { queryCommand } = await import('../query.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');

    vi.mocked(createSqliteStorage).mockReturnValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 100,
        totalEmbeddings: 20,
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--strategy', 'semantic', '--json'],
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_EMBEDDING_COVERAGE' });
  });

  it('applies --limit to JSON output packs', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [],
      drillDownHints: [],
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 't1', summary: 'a', keyFacts: [], relatedFiles: [], codeSnippets: [], confidence: 0.8, createdAt: new Date(), version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() } },
        { packId: 'p2', packType: 'function_context', targetId: 't2', summary: 'b', keyFacts: [], relatedFiles: [], codeSnippets: [], confidence: 0.7, createdAt: new Date(), version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() } },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--limit', '1', '--json'],
    });

    const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}');
    expect(parsed.packs).toHaveLength(1);
  });

  it('writes JSON output to --out path', async () => {
    const { queryCommand } = await import('../query.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-out-'));
    const outPath = path.join(tmpDir, 'query.json');

    try {
      await queryCommand({
        workspace: '/tmp/workspace',
        args: [],
        rawArgs: ['query', 'hello world', '--json', '--out', outPath],
      });

      const raw = await fs.readFile(outPath, 'utf8');
      const parsed = JSON.parse(raw) as { strategy?: string };
      expect(typeof parsed.strategy).toBe('string');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('sanitizes unverified trace markers in JSON output fields', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: ['unverified_by_trace(storage_write_degraded): Session degraded due to lock contention.'],
      traceId: 'unverified_by_trace(replay_unavailable)',
      llmError: 'unverified_by_trace(provider_unavailable): Embedding provider unavailable',
      coverageGaps: ['unverified_by_trace(provider_unavailable): Embedding provider unavailable'],
      methodHints: ['unverified_by_trace(provider_unavailable): Try provider diagnostics.'],
      drillDownHints: ['unverified_by_trace(provider_unavailable): Retry after provider setup.'],
      packs: [
        {
          packId: 'p1',
          packType: 'function_context',
          targetId: 't1',
          summary: 'unverified_by_trace(provider_unavailable): Structural-only summary.',
          keyFacts: ['unverified_by_trace(provider_unavailable): fact'],
          relatedFiles: [],
          codeSnippets: [],
          confidence: 0.8,
          createdAt: new Date(),
          version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
        },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}');

    expect(parsed.disclosures).toEqual(['Session degraded due to lock contention.']);
    expect(parsed.traceId).toBe('replay_unavailable');
    expect(parsed.llmError).toBe('Embedding provider unavailable');
    expect(parsed.coverageGaps?.[0]).toBe('Embedding provider unavailable');
    expect(parsed.methodHints?.[0]).toBe('Try provider diagnostics.');
    expect(parsed.drillDownHints?.[0]).toBe('Retry after provider setup.');
    expect(parsed.packs?.[0]?.summary).toBe('Structural-only summary.');
    expect(parsed.packs?.[0]?.keyFacts?.[0]).toBe('fact');
  });

  it('rejects --out without --json', async () => {
    const { queryCommand } = await import('../query.js');
    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--out', '/tmp/query.json'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('starts a persistent session with --session new', async () => {
    const { queryCommand } = await import('../query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });

      const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput ?? '{}') as { mode?: string; sessionId?: string };
      expect(parsed.mode).toBe('start');
      expect(parsed.sessionId).toMatch(/^sess_/);

      const sessionPath = path.join(workspace, '.librarian', 'query_sessions', `${parsed.sessionId}.json`);
      const stored = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as { session?: { sessionId?: string } };
      expect(stored.session?.sessionId).toBe(parsed.sessionId);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('continues a persisted session with follow-up intent', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });
      const startOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const started = JSON.parse(startOutput ?? '{}') as { sessionId?: string };
      expect(started.sessionId).toBeTruthy();

      logSpy?.mockClear();
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'token refresh details', '--session', started.sessionId!, '--json'],
      });
      const followUpOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const followUp = JSON.parse(followUpOutput ?? '{}') as { mode?: string; sessionId?: string };
      expect(followUp.mode).toBe('follow_up');
      expect(followUp.sessionId).toBe(started.sessionId);

      const intents = vi.mocked(queryLibrarian).mock.calls.map((call) => call[0]?.intent);
      expect(intents).toContain('token refresh details');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('supports drill-down in persisted sessions without requiring intent text', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });
      const startOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const started = JSON.parse(startOutput ?? '{}') as { sessionId?: string };
      expect(started.sessionId).toBeTruthy();

      logSpy?.mockClear();
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', '--session', started.sessionId!, '--drill-down', 'src/auth/session.ts', '--json'],
      });
      const drillOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const drill = JSON.parse(drillOutput ?? '{}') as { mode?: string };
      expect(drill.mode).toBe('drill_down');

      const intents = vi.mocked(queryLibrarian).mock.calls.map((call) => call[0]?.intent);
      expect(intents).toContain('Drill down: src/auth/session.ts');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('uses session-scoped provider selection for follow-up calls and exposes selection metadata in JSON output', async () => {
    const { queryCommand } = await import('../query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-provider-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });
      const startOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const started = JSON.parse(startOutput ?? '{}') as { sessionId?: string };
      expect(started.sessionId).toBeTruthy();

      const sessionPath = path.join(workspace, '.librarian', 'query_sessions', `${started.sessionId}.json`);
      const persisted = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as {
        session?: Record<string, unknown>;
      };
      persisted.session = {
        ...(persisted.session ?? {}),
        llmSelection: {
          provider: 'codex',
          modelId: 'gpt-5-codex',
          updatedAt: new Date().toISOString(),
        },
      };
      await fs.writeFile(sessionPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

      logSpy?.mockClear();
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'token refresh details', '--session', started.sessionId!, '--json'],
      });
      const followUpOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const followUp = JSON.parse(followUpOutput ?? '{}') as {
        selectedProvider?: string;
        selectedModel?: string;
        selectionSource?: string;
      };
      expect(followUp.selectedProvider).toBe('codex');
      expect(followUp.selectedModel).toBe('gpt-5-codex');
      expect(followUp.selectionSource).toBe('session');
      expect(process.env.LIBRARIAN_LLM_PROVIDER).toBe('codex');
      expect(process.env.LIBRARIAN_LLM_MODEL).toBe('gpt-5-codex');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('surfaces critical storage and synthesis warnings before coverage gaps', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [
        'unverified_by_trace(storage_write_degraded): Session degraded: results were returned but could not be persisted.',
      ],
      drillDownHints: [
        'Session degraded: results were returned but could not be persisted (storage lock compromised). Run `librarian doctor --heal` to recover.',
      ],
      coverageGaps: [
        'Synthesis failed: Claude CLI error',
      ],
      llmError: 'Claude CLI error: auth expired',
      synthesisMode: 'heuristic',
      packs: [],
      synthesis: undefined,
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world'],
    });

    const lines = logSpy?.mock.calls.map((call) => String(call[0])) ?? [];
    const criticalWarningsIndex = lines.findIndex((line) => line.includes('Critical Warnings:'));
    const coverageGapsIndex = lines.findIndex((line) => line.includes('Coverage Gaps:'));

    expect(criticalWarningsIndex).toBeGreaterThan(-1);
    expect(coverageGapsIndex).toBeGreaterThan(-1);
    expect(criticalWarningsIndex).toBeLessThan(coverageGapsIndex);
    expect(lines.some((line) => line.includes('LLM synthesis error: Claude CLI error: auth expired'))).toBe(true);
    expect(lines.some((line) => line.includes('Session degraded: results were returned but could not be persisted'))).toBe(true);
    expect(lines.some((line) => line.includes('LLM synthesis unavailable: results are structural-only'))).toBe(true);
  });

  it('surfaces partial-index and low-confidence quality warnings at top', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.094,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: ['coherence_warning: result set appears scattered'],
      drillDownHints: ['Result coherence: Results appear scattered/incoherent (36%).'],
      coverageGaps: ['Index structural scan (19% complete). Results may be incomplete.'],
      packs: [],
      synthesis: undefined,
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world'],
    });

    const lines = logSpy?.mock.calls.map((call) => String(call[0])) ?? [];
    const criticalWarningsIndex = lines.findIndex((line) => line.includes('Critical Warnings:'));
    const coverageGapsIndex = lines.findIndex((line) => line.includes('Coverage Gaps:'));

    expect(criticalWarningsIndex).toBeGreaterThan(-1);
    expect(coverageGapsIndex).toBeGreaterThan(-1);
    expect(criticalWarningsIndex).toBeLessThan(coverageGapsIndex);
    expect(lines.some((line) => line.includes('Index structural scan (19% complete). Results may be incomplete.'))).toBe(true);
    expect(lines.some((line) => line.includes('Low confidence (0.094)'))).toBe(true);
    expect(lines.some((line) => line.includes('Result coherence:'))).toBe(true);
  });
});
