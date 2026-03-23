import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { inspectCommand } from '../inspect.js';
import { confidenceCommand } from '../confidence.js';
import { validateCommand } from '../validate.js';
import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { isBootstrapRequired } from '../../../api/bootstrap.js';
import { getConfidenceCalibration, summarizeCalibration, computeUncertaintyMetrics } from '../../../api/confidence_calibration.js';
import { ConstraintEngine } from '../../../engines/constraint_engine.js';
import type { LibrarianStorage } from '../../../storage/types.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));
vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));
vi.mock('../../../api/bootstrap.js', () => ({
  isBootstrapRequired: vi.fn(),
}));
vi.mock('../../../api/confidence_calibration.js', () => ({
  getConfidenceCalibration: vi.fn(),
  summarizeCalibration: vi.fn(),
  computeUncertaintyMetrics: vi.fn(),
}));
vi.mock('../../../engines/constraint_engine.js', () => ({
  ConstraintEngine: vi.fn(),
}));

describe('inspect/confidence/validate on MVP-ready indexes', () => {
  const workspace = '/test/workspace';
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockStorage: {
    initialize: Mock;
    close: Mock;
    getModules: Mock;
    getFunctions: Mock;
    getContextPacks: Mock;
    getGraphEdges: Mock;
    getFunction: Mock;
    getModule: Mock;
    getContextPack: Mock;
    getQualityScoreHistory: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getModules: vi.fn().mockResolvedValue([
        {
          id: 'module:src/api/query.ts',
          path: 'src/api/query.ts',
          purpose: 'Query pipeline orchestrator',
          confidence: 0.91,
          exports: ['queryLibrarian'],
          dependencies: ['src/api/query_synthesis.ts'],
        },
      ]),
      getFunctions: vi.fn().mockResolvedValue([
        {
          id: 'function:queryLibrarian',
          name: 'queryLibrarian',
          filePath: 'src/api/query.ts',
          startLine: 10,
          endLine: 20,
          signature: 'queryLibrarian(intent: string)',
          purpose: 'Runs the query pipeline',
          confidence: 0.88,
          accessCount: 3,
          lastAccessed: null,
          validationCount: 2,
          outcomeHistory: { successes: 2, failures: 0 },
          embedding: null,
        },
      ]),
      getContextPacks: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getFunction: vi.fn().mockResolvedValue(null),
      getModule: vi.fn().mockResolvedValue({
        confidence: 0.84,
        path: 'src/api/query.ts',
      }),
      getContextPack: vi.fn().mockResolvedValue(null),
      getQualityScoreHistory: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(resolveDbPath).mockResolvedValue('/tmp/librarian.sqlite');
    vi.mocked(createSqliteStorage).mockReturnValue(mockStorage as unknown as LibrarianStorage);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'mvp-ready' });
    vi.mocked(getConfidenceCalibration).mockResolvedValue({
      buckets: [],
    } as never);
    vi.mocked(summarizeCalibration).mockReturnValue({
      bucketCount: 0,
      sampleCount: 0,
      expectedCalibrationError: 0,
      maxCalibrationError: 0,
    });
    vi.mocked(computeUncertaintyMetrics).mockReturnValue({
      entropy: 0.1,
      variance: 0.02,
    });
    vi.mocked(ConstraintEngine).mockImplementation(() => ({
      getApplicableConstraints: vi.fn().mockResolvedValue([]),
      validateChange: vi.fn().mockResolvedValue({
        violations: [],
        warnings: [],
        blocking: false,
        proceedReason: 'No violations detected.',
      }),
      getBoundaries: vi.fn().mockResolvedValue([]),
      inferConstraints: vi.fn().mockResolvedValue([]),
    }) as unknown as ConstraintEngine);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('lets inspect read from an MVP-ready index', async () => {
    await inspectCommand({
      workspace,
      args: ['src/api/query.ts', '--json'],
    });

    expect(isBootstrapRequired).toHaveBeenCalledWith(workspace, expect.anything(), { targetQualityTier: 'mvp' });
    const payload = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as { module?: { path?: string } };
    expect(payload.module?.path).toBe('src/api/query.ts');
  });

  it('lets confidence read from an MVP-ready index', async () => {
    await confidenceCommand({
      workspace,
      args: ['module:src/api/query.ts', '--json'],
    });

    expect(isBootstrapRequired).toHaveBeenCalledWith(workspace, expect.anything(), { targetQualityTier: 'mvp' });
    const payload = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as { entityType?: string; entityName?: string };
    expect(payload.entityType).toBe('module');
    expect(payload.entityName).toBe('src/api/query.ts');
  });

  it('lets validate run from an MVP-ready index', async () => {
    await validateCommand({
      workspace,
      args: ['src/api/query.ts', '--after', 'export const x = 1;', '--json'],
    });

    expect(isBootstrapRequired).toHaveBeenCalledWith(workspace, expect.anything(), { targetQualityTier: 'mvp' });
    const payload = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as { file?: string; blocking?: boolean };
    expect(payload.file).toBe('src/api/query.ts');
    expect(payload.blocking).toBe(false);
  });
});
