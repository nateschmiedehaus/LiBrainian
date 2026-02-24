import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IngestionItem } from '../../ingest/types.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { QueryIntelStorage } from '../query_intel.js';
import { buildQueryIntelSections, __testing } from '../query_intel.js';
import type { ContextPack, LibrarianVersion } from '../../types.js';
import type { UniversalKnowledgeRecord } from '../../storage/types.js';
import { getCurrentVersion } from '../versioning.js';

const baseVersion: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'full',
  indexedAt: new Date('2026-02-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

function createPack(filePath: string, overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    packId: `pack-${Math.random().toString(36).slice(2)}`,
    packType: 'function_context',
    targetId: `target:${filePath}`,
    summary: 'Test context pack',
    keyFacts: ['Key fact'],
    codeSnippets: [{
      filePath,
      startLine: 1,
      endLine: 10,
      content: 'export function value(): string { return "x"; }',
      language: 'typescript',
    }],
    relatedFiles: [filePath],
    confidence: 0.8,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: baseVersion,
    invalidationTriggers: [],
    ...overrides,
  };
}

function createKnowledgeRecord(
  file: string,
  overrides: {
    maintainabilityIndex?: number;
    riskScore?: number;
    changeCount?: number;
    changeFrequency?: number;
    purposeSummary?: string;
    vulnerabilities?: string[];
  } = {}
): UniversalKnowledgeRecord {
  const knowledge = {
    quality: {
      maintainability: { index: overrides.maintainabilityIndex ?? 82 },
      churn: {
        changeCount: overrides.changeCount ?? 0,
        changeFrequency: overrides.changeFrequency ?? 0,
      },
    },
    security: {
      riskScore: { overall: overrides.riskScore ?? 0.1 },
      vulnerabilities: (overrides.vulnerabilities ?? []).map((description) => ({ description })),
      threatModel: { threatVectors: [] as Array<{ description: string }> },
    },
  };

  return {
    id: `uk-${file.replace(/[^\w]/g, '_')}`,
    kind: 'function',
    name: 'value',
    qualifiedName: `value@${file}`,
    file,
    line: 1,
    knowledge: JSON.stringify(knowledge),
    purposeSummary: overrides.purposeSummary ?? 'Knowledge summary',
    maintainabilityIndex: overrides.maintainabilityIndex ?? 82,
    riskScore: overrides.riskScore ?? 0.1,
    confidence: 0.9,
    generatedAt: '2026-02-01T00:00:00.000Z',
    hash: `hash-${file}`,
  };
}

function createOwnershipItem(relativePath: string, owner: string, lastTouchedAt: string): IngestionItem {
  return {
    id: `ownership:${relativePath}`,
    sourceType: 'ownership',
    sourceVersion: 'v1',
    ingestedAt: '2026-02-01T00:00:00.000Z',
    payload: {
      path: relativePath,
      primaryOwner: owner,
      contributors: [owner],
      lastTouchedAt,
    },
    metadata: {},
  };
}

function createStorage(overrides: Partial<QueryIntelStorage> = {}): QueryIntelStorage {
  return {
    getUniversalKnowledgeByFile: async () => [],
    getIngestionItem: async () => null,
    getCochangeEdges: async () => [],
    ...overrides,
  };
}

describe('buildQueryIntelSections', () => {
  it('surfaces risk highlights at L1+ when risk score is above medium', async () => {
    const file = '/repo/src/auth/token.ts';
    const storage = createStorage({
      getUniversalKnowledgeByFile: async () => [
        createKnowledgeRecord(file, {
          riskScore: 0.9,
          vulnerabilities: ['JWT signing key handling missing rotation'],
        }),
      ],
    });

    const intel = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L1',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    expect(intel.riskHighlights).toBeDefined();
    expect(intel.riskHighlights?.[0]?.entity).toBe(file);
    expect(intel.riskHighlights?.[0]?.risk).toBe('CRITICAL');
    expect(intel.riskHighlights?.[0]?.rationale).toContain('JWT signing key handling');
  });

  it('enforces stability threshold when entity changed more than 4 times in 30d', async () => {
    const file = '/repo/src/auth/validate.ts';
    const storage = createStorage({
      getUniversalKnowledgeByFile: async () => [
        createKnowledgeRecord(file, { changeCount: 6, changeFrequency: 5 }),
      ],
    });

    const intel = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L1',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    expect(intel.stabilityAlerts).toEqual([{
      entity: file,
      changes: 6,
      period: '30d',
      trend: 'increasing',
    }]);
  });

  it('includes ownership context only when owner and lastActive are present', async () => {
    const file = '/repo/src/auth/token.ts';
    const storage = createStorage({
      getUniversalKnowledgeByFile: async () => [createKnowledgeRecord(file)],
      getIngestionItem: async (id: string) => {
        if (id === 'ownership:src/auth/token.ts') {
          return createOwnershipItem('src/auth/token.ts', 'alice', '2026-02-18T12:00:00.000Z');
        }
        return null;
      },
    });

    const intel = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L1',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    expect(intel.ownershipContext).toEqual([{
      entity: file,
      owner: 'alice',
      lastActive: '2026-02-18T12:00:00.000Z',
    }]);
  });

  it('includes maintainability only for L2+', async () => {
    const file = '/repo/src/core/engine.ts';
    const storage = createStorage({
      getUniversalKnowledgeByFile: async () => [createKnowledgeRecord(file, { maintainabilityIndex: 47 })],
    });

    const intelL1 = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L1',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    const intelL2 = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L2',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    expect(intelL1.entityIntel?.[0]?.maintainabilityIndex).toBeUndefined();
    expect(intelL2.entityIntel?.[0]?.maintainabilityIndex).toBe(47);
  });

  it('includes co-change peers only above 80% correlation', async () => {
    const file = '/repo/src/core/cache.ts';
    const storage = createStorage({
      getUniversalKnowledgeByFile: async () => [createKnowledgeRecord(file)],
      getCochangeEdges: async () => [
        {
          fileA: 'src/core/cache.ts',
          fileB: 'src/core/storage.ts',
          changeCount: 10,
          totalChanges: 11,
          strength: 0.91,
        },
        {
          fileA: 'src/core/cache.ts',
          fileB: 'src/core/logger.ts',
          changeCount: 3,
          totalChanges: 10,
          strength: 0.3,
        },
      ],
    });

    const intel = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L2',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    expect(intel.entityIntel?.[0]?.coChangesWith).toEqual(['/repo/src/core/storage.ts']);
  });

  it('omits fields entirely when data is absent', async () => {
    const file = '/repo/src/core/empty.ts';
    const storage = createStorage({
      getUniversalKnowledgeByFile: async () => [createKnowledgeRecord(file, { riskScore: 0.1, changeCount: 0 })],
    });

    const intel = await buildQueryIntelSections({
      storage,
      packs: [createPack(file)],
      depth: 'L0',
      workspaceRoot: '/repo',
      maxResponseTokens: 1200,
    });

    expect(intel.riskHighlights).toBeUndefined();
    expect(intel.stabilityAlerts).toBeUndefined();
    expect(intel.ownershipContext).toBeUndefined();
    expect(intel.entityIntel).toBeUndefined();
  });

  it('caps intel sections to <=15% of response budget', async () => {
    const files = Array.from({ length: 6 }, (_, idx) => `/repo/src/risky-${idx}.ts`);
    const storage = createStorage({
      getUniversalKnowledgeByFile: async (filePath: string) => [
        createKnowledgeRecord(filePath, {
          riskScore: 0.95,
          vulnerabilities: ['Very long vulnerability rationale that consumes many tokens in serialized output'],
          changeCount: 10,
          changeFrequency: 10,
          maintainabilityIndex: 22,
        }),
      ],
    });

    const intel = await buildQueryIntelSections({
      storage,
      packs: files.map((file) => createPack(file)),
      depth: 'L2',
      workspaceRoot: '/repo',
      maxResponseTokens: 120,
    });

    expect(__testing.estimateIntelTokens(intel)).toBeLessThanOrEqual(18);
  });
});

describe('buildQueryIntelSections integration (sqlite storage)', () => {
  let workspace = '';
  let dbPath = '';

  afterEach(async () => {
    if (workspace) {
      await fs.rm(workspace, { recursive: true, force: true });
      workspace = '';
    }
    if (dbPath) {
      await fs.rm(dbPath, { force: true });
      dbPath = '';
    }
  });

  it('projects risk, ownership, stability, and cochange intel from real storage records', async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'query-intel-workspace-'));
    dbPath = path.join(os.tmpdir(), `query-intel-${randomUUID()}.db`);
    const targetFileRelative = 'src/intel.ts';
    const targetFile = path.join(workspace, targetFileRelative);
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, 'export const intel = 1;\n', 'utf8');

    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    await storage.setVersion(getCurrentVersion());

    await storage.upsertUniversalKnowledge(createKnowledgeRecord(targetFileRelative, {
      riskScore: 0.88,
      maintainabilityIndex: 41,
      changeCount: 7,
      changeFrequency: 5,
      vulnerabilities: ['Privilege boundary crossed without strict validation'],
    }));

    await storage.upsertIngestionItem(createOwnershipItem(targetFileRelative, 'core-team', '2026-02-20T08:30:00.000Z'));

    await storage.storeCochangeEdges([{
      fileA: targetFileRelative,
      fileB: 'src/dependency.ts',
      changeCount: 9,
      totalChanges: 10,
      strength: 0.9,
    }]);

    const intel = await buildQueryIntelSections({
      storage,
      packs: [createPack(targetFile)],
      depth: 'L2',
      workspaceRoot: workspace,
      maxResponseTokens: 2000,
    });

    expect(intel.riskHighlights?.length ?? 0).toBeGreaterThan(0);
    expect(intel.stabilityAlerts?.length ?? 0).toBeGreaterThan(0);
    expect(intel.ownershipContext?.length ?? 0).toBeGreaterThan(0);
    expect(intel.entityIntel?.[0]?.coChangesWith).toContain(path.join(workspace, 'src/dependency.ts').replace(/\\/g, '/'));

    await storage.close();
  });
});
