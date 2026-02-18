/**
 * @fileoverview Tests for query command LLM resolution behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.LIBRARIAN_LLM_MODEL;
  });

  afterEach(() => {
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
});
