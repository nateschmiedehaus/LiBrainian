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

  it('rejects --out without --json', async () => {
    const { queryCommand } = await import('../query.js');
    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--out', '/tmp/query.json'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
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
