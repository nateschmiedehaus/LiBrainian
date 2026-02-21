import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { getCurrentVersion } from '../api/versioning.js';
import type { ContextPack } from '../types.js';
import { applyCalibrationToPacks, getConfidenceCalibration } from '../api/confidence_calibration.js';
import { cleanupWorkspace } from './helpers/index.js';

let workspaceRoot = '';
let storage: ReturnType<typeof createSqliteStorage>;

const createWorkspace = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-calibration-'));
  const canonPath = path.join(root, 'config', 'canon.json');
  await fs.mkdir(path.dirname(canonPath), { recursive: true });
  await fs.writeFile(canonPath, JSON.stringify({ schema_version: 1 }, null, 2));
  return root;
};

const buildPack = (packId: string, confidence: number, successes: number, failures: number): ContextPack => ({
  packId,
  packType: 'module_context',
  targetId: randomUUID(),
  summary: `Context for ${packId}`,
  keyFacts: [],
  codeSnippets: [],
  relatedFiles: [`src/${packId}.ts`],
  confidence,
  createdAt: new Date(),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: successes,
  failureCount: failures,
  version: getCurrentVersion(),
  invalidationTriggers: [`src/${packId}.ts`],
});

describe('confidence calibration', () => {
  beforeAll(async () => {
    workspaceRoot = await createWorkspace();
    storage = createSqliteStorage(':memory:', workspaceRoot);
    await storage.initialize();
    await storage.setVersion(getCurrentVersion());
  });

  afterAll(async () => {
    await cleanupWorkspace(workspaceRoot);
  });

  it('computes calibration buckets from pack outcomes', async () => {
    await storage.upsertContextPack(buildPack('pack-high', 0.9, 9, 1));
    await storage.upsertContextPack(buildPack('pack-low', 0.2, 1, 4));

    const report = await getConfidenceCalibration(storage, { bucketCount: 5, ttlMs: 0 });
    expect(report.sampleCount).toBe(15);

    const highBucket = report.buckets.find((bucket) => bucket.bucket === 4);
    const lowBucket = report.buckets.find((bucket) => bucket.bucket === 1);

    expect(highBucket?.observedSuccess).toBeCloseTo(0.9, 2);
    expect(lowBucket?.observedSuccess).toBeCloseTo(0.2, 2);
  });

  it('applies calibrated confidence to response packs', async () => {
    const packs = await storage.getContextPacks();
    const report = await getConfidenceCalibration(storage, { bucketCount: 5, ttlMs: 0 });
    const calibrated = applyCalibrationToPacks(packs, report, { minSamplesForFullWeight: 1 });

    const high = calibrated.find((pack) => pack.packId === 'pack-high');
    const low = calibrated.find((pack) => pack.packId === 'pack-low');

    expect(high?.confidence).toBeCloseTo(0.9, 2);
    expect(high?.rawConfidence).toBeCloseTo(0.9, 2);
    expect(high?.uncertainty).toBeGreaterThanOrEqual(0);
    expect(low?.confidence).toBeCloseTo(0.2, 2);
  });
});
