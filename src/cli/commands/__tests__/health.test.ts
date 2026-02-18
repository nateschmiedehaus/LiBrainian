import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { healthCommand } from '../health.js';
import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { generateStateReport } from '../../../measurement/observability.js';
import { isBootstrapRequired } from '../../../api/bootstrap.js';
import type { LibrarianStorage } from '../../../storage/types.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));

vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));

vi.mock('../../../measurement/observability.js', () => ({
  generateStateReport: vi.fn(),
  exportPrometheusMetrics: vi.fn(() => 'librarian_metric 1'),
}));

vi.mock('../../../metrics/index_completeness.js', () => ({
  calculateIndexCompleteness: vi.fn(),
  formatCompletenessReport: vi.fn(() => 'completeness'),
  exportPrometheusMetrics: vi.fn(() => 'librarian_completeness 1'),
}));

vi.mock('../../../api/bootstrap.js', () => ({
  isBootstrapRequired: vi.fn(),
}));

function createStorageStub(): LibrarianStorage {
  return {
    initialize: vi.fn().mockResolvedValue(undefined) as Mock,
    close: vi.fn().mockResolvedValue(undefined) as Mock,
  } as unknown as LibrarianStorage;
}

describe('healthCommand', () => {
  const workspace = '/tmp/librarian-health-workspace';
  const dbPath = '/tmp/librarian-health.sqlite';
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(resolveDbPath).mockResolvedValue(dbPath);
    vi.mocked(createSqliteStorage).mockImplementation(() => createStorageStub());
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(generateStateReport).mockResolvedValue({
      generatedAt: new Date('2026-02-05T00:00:00.000Z').toISOString(),
      recoveryState: 'healthy',
      health: {
        status: 'healthy',
        checks: {
          indexFresh: true,
          confidenceAcceptable: true,
          defeatersLow: true,
          latencyAcceptable: true,
          coverageAcceptable: true,
        },
        degradationReasons: [],
      },
      codeGraphHealth: { entityCount: 1, relationCount: 1, coverageRatio: 1, orphanEntities: 0 },
      indexFreshness: { lastIndexTime: null, stalenessMs: 0, pendingChanges: 0 },
      confidenceState: { meanConfidence: 1, geometricMeanConfidence: 1, lowConfidenceCount: 0, defeaterCount: 0 },
      queryPerformance: { queryLatencyP50: 1, queryLatencyP99: 1, cacheHitRate: 1, queryCount: 1 },
    } as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('fails closed with exit code 1 when bootstrap is required', async () => {
    vi.mocked(isBootstrapRequired).mockResolvedValue({
      required: true,
      reason: 'No indexed files found',
    });

    await expect(healthCommand({ workspace, format: 'json' })).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    const raw = consoleLogSpy.mock.calls.at(-1)?.[0];
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw as string) as {
      status?: string;
      reason?: string;
      message?: string;
      provenance?: { status?: string };
    };
    expect(parsed.status).toBe('unhealthy');
    expect(parsed.reason).toBe('bootstrap_required');
    expect(parsed.message).toContain('No indexed files found');
    expect(parsed.provenance?.status).toBeDefined();
  });

  it('fails closed with exit code 1 when storage initialization fails', async () => {
    vi.mocked(createSqliteStorage).mockImplementation(() => ({
      initialize: vi.fn().mockRejectedValue(new Error('SQLITE_CANTOPEN')) as Mock,
      close: vi.fn().mockResolvedValue(undefined) as Mock,
    } as unknown as LibrarianStorage));

    await expect(healthCommand({ workspace, format: 'json' })).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    const raw = consoleLogSpy.mock.calls.at(-1)?.[0];
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw as string) as {
      reason?: string;
      message?: string;
      provenance?: { status?: string };
    };
    expect(parsed.reason).toBe('storage_unavailable');
    expect(parsed.message).toContain('SQLITE_CANTOPEN');
    expect(parsed.provenance?.status).toBeDefined();
  });

  it('includes verification provenance in healthy JSON output', async () => {
    await expect(healthCommand({ workspace, format: 'json' })).resolves.toBeUndefined();

    const raw = consoleLogSpy.mock.calls.at(-1)?.[0];
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw as string) as { health?: { status?: string }; provenance?: { status?: string } };
    expect(parsed.health?.status).toBe('healthy');
    expect(parsed.provenance?.status).toBeDefined();
  });
});
