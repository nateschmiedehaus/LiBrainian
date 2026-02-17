import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { BOOTSTRAP_PHASES, type BootstrapReport } from '../../types.js';
import { getCurrentVersion } from '../versioning.js';
import { createOnboardingBaseline, writeOnboardingBaseline } from '../reporting.js';

vi.mock('../provider_check.js', () => ({
  checkProviderSnapshot: vi.fn().mockResolvedValue({
    status: {
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 123, error: 'unavailable' },
      embedding: { available: true, provider: 'local', model: 'all-MiniLM-L6-v2', latencyMs: 123 },
    },
    remediationSteps: [],
    reason: 'embedding-only',
  }),
}));

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-onboarding-baseline-${randomUUID()}.db`);
}

function getSemanticPhase() {
  const phase = BOOTSTRAP_PHASES.find((entry) => entry.name === 'semantic_indexing');
  if (!phase) {
    throw new Error('semantic_indexing phase missing');
  }
  return phase;
}

describe('onboarding baseline reporting', () => {
  let storage: LibrarianStorage | null = null;
  let workspaceRoot: string | null = null;

  afterEach(async () => {
    if (storage) {
      await storage.close();
      storage = null;
    }
    if (workspaceRoot) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      workspaceRoot = null;
    }
  });

  it('creates onboarding baseline metrics from a bootstrap report', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-onboard-'));
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();

    await storage.upsertContextPack({
      packId: 'pack-1',
      packType: 'function_context',
      targetId: 'fn-1',
      summary: 'Sample context pack',
      keyFacts: ['fact'],
      codeSnippets: [],
      relatedFiles: ['src/example.ts'],
      confidence: 0.6,
      createdAt: new Date('2026-02-05T00:00:00.000Z'),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: getCurrentVersion(),
      invalidationTriggers: [],
    });

    const startedAt = new Date('2026-02-05T00:00:00.000Z');
    const completedAt = new Date('2026-02-05T00:00:05.000Z');
    const report: BootstrapReport = {
      workspace: workspaceRoot,
      startedAt,
      completedAt,
      phases: [
        {
          phase: getSemanticPhase(),
          startedAt,
          completedAt,
          durationMs: 5000,
          itemsProcessed: 10,
          errors: [],
          metrics: {
            totalFiles: 10,
            filesIndexed: 8,
          },
        },
      ],
      totalFilesProcessed: 8,
      totalFunctionsIndexed: 0,
      totalContextPacksCreated: 1,
      version: getCurrentVersion(),
      success: true,
    };

    const baseline = await createOnboardingBaseline({
      workspaceRoot,
      report,
      storage,
    });

    expect(baseline.kind).toBe('OnboardingBaseline.v1');
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.metrics.bootstrapDurationMs).toBe(5000);
    expect(baseline.metrics.entityCoverage).toBeCloseTo(0.8);
    expect(baseline.metrics.confidenceMean).toBeCloseTo(0.6);
    expect(baseline.entities.files).toBe(8);
  });

  it('writes onboarding baseline to the audits directory', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-onboard-'));
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();

    const report: BootstrapReport = {
      workspace: workspaceRoot,
      startedAt: new Date('2026-02-05T00:00:00.000Z'),
      completedAt: new Date('2026-02-05T00:00:05.000Z'),
      phases: [],
      totalFilesProcessed: 0,
      totalFunctionsIndexed: 0,
      totalContextPacksCreated: 0,
      version: getCurrentVersion(),
      success: true,
    };

    const baseline = await createOnboardingBaseline({
      workspaceRoot,
      report,
      storage,
    });
    const outputPath = await writeOnboardingBaseline(workspaceRoot, baseline);

    const raw = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(raw) as { kind?: string };
    expect(parsed.kind).toBe('OnboardingBaseline.v1');
  });
});
