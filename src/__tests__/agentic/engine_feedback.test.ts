import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibrarianStorage } from '../../storage/types.js';
import type { ContextPack, ModuleKnowledge } from '../../types.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { getCurrentVersion } from '../../api/versioning.js';
import { requireProviders } from '../../api/provider_check.js';
import { EmbeddingService } from '../../api/embeddings.js';
import { RelevanceEngine } from '../../engines/relevance_engine.js';
import { ConstraintEngine } from '../../engines/constraint_engine.js';
import { MetaKnowledgeEngine } from '../../engines/meta_engine.js';
import { cleanupWorkspace } from '../helpers/index.js';

const IS_TIER0 = Boolean(process.env.LIBRARIAN_FAIL_OPEN_LOG_DIR);
const agenticSuite = IS_TIER0 ? describe.skip : describe.sequential;

let workspaceRoot: string;
let storage: LibrarianStorage;
let embeddingService: EmbeddingService;
let serviceModule: ModuleKnowledge;
let criticalModule: ModuleKnowledge;
let version = getCurrentVersion();

const EMBEDDING_DIMENSION = resolveTestEmbeddingDimension();

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-agentic-'));
  const dirs = [
    path.join(root, 'src', 'users'),
    path.join(root, 'src', 'db'),
    path.join(root, 'src', 'critical'),
    path.join(root, 'config'),
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  await fs.writeFile(
    path.join(root, 'src', 'users', 'service.ts'),
    'export function getUser() { return "ok"; }\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'db', 'users.ts'),
    'export async function withTransaction() { return "transaction"; }\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'db', 'products.ts'),
    'export async function createProduct() { return "db.query"; }\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'critical', 'thing.ts'),
    'export const critical = true;\n'
  );
  // Required for librarian migrations
  await fs.writeFile(
    path.join(root, 'config', 'canon.json'),
    JSON.stringify({ schema_version: 1 }, null, 2) + '\n'
  );

  return root;
}

function buildModule(pathValue: string, exports: string[] = [], dependencies: string[] = []): ModuleKnowledge {
  return {
    id: randomUUID(),
    path: pathValue,
    purpose: `Module ${path.basename(pathValue)}`,
    exports,
    dependencies,
    confidence: 0.7,
  };
}

function buildContextPack(packId: string, targetId: string, relatedFiles: string[], confidence: number, overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    packId,
    packType: 'module_context',
    targetId,
    summary: `Context for ${path.basename(relatedFiles[0] ?? 'module')}`,
    keyFacts: [],
    codeSnippets: [],
    relatedFiles,
    confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: relatedFiles,
    ...overrides,
  };
}

agenticSuite('Librarian Agentic Engine Feedback', () => {
  beforeAll(async () => {
    workspaceRoot = await createWorkspace();
    storage = createSqliteStorage(':memory:', workspaceRoot);
    await storage.initialize();
    await storage.setVersion(version);

    await requireProviders({ llm: true, embedding: true }, { workspaceRoot: process.cwd() });

    // Real embedding providers (xenova/sentence-transformers) are auto-configured
    // NO LLM-generated embeddings (they're hallucinated numbers, not real vectors)
    embeddingService = new EmbeddingService({
      embeddingDimension: EMBEDDING_DIMENSION,
      maxBatchSize: 5,
      maxConcurrentBatches: 1,
      batchDelayMs: 0,
    });

    await embeddingService.generateEmbedding({ text: 'health check', kind: 'query' });

    serviceModule = buildModule(path.join(workspaceRoot, 'src', 'users', 'service.ts'));
    criticalModule = buildModule(path.join(workspaceRoot, 'src', 'critical', 'thing.ts'));
    await storage.upsertModule(serviceModule);
    await storage.upsertModule(criticalModule);

    const pack = buildContextPack('pack-service', serviceModule.id, [serviceModule.path], 0.72);
    await storage.upsertContextPack(pack);
  }, 300_000); // Extended timeout for provider initialization and embedding

  afterAll(async () => {
    if (storage) await storage.close();
    if (workspaceRoot) await cleanupWorkspace(workspaceRoot);
  });

  it('relevance improves after feedback', async () => {
    const relevance = new RelevanceEngine(storage, embeddingService, workspaceRoot);
    const intent = 'add caching to user service';
    const initial = await relevance.query({
      intent,
      hints: [serviceModule.path],
      budget: { maxFiles: 6, maxTokens: 5000, maxDepth: 1 },
      urgency: 'blocking',
    });

    expect(initial.tiers.essential.length + initial.tiers.contextual.length + initial.tiers.reference.length).toBeGreaterThan(0);

    relevance.learnNegative('task-1', ['src/cache/redis.ts']);

    const updated = await relevance.query({
      intent,
      hints: [serviceModule.path],
      budget: { maxFiles: 6, maxTokens: 5000, maxDepth: 1 },
      urgency: 'blocking',
    });

    const learnedInBlindSpots = updated.blindSpots.some((spot) => spot.area === 'src/cache/redis.ts');
    const learnedInTiers = updated.tiers.reference.some((item) => item.relatedFiles.includes('src/cache/redis.ts'))
      || updated.tiers.contextual.some((item) => item.relatedFiles.includes('src/cache/redis.ts'))
      || updated.tiers.essential.some((item) => item.relatedFiles.includes('src/cache/redis.ts'));

    expect(learnedInBlindSpots || learnedInTiers).toBe(true);
  }, 120_000);

  it('constraint suggestions are learned', async () => {
    const constraint = new ConstraintEngine(storage, workspaceRoot);
    constraint.suggestConstraint({
      rule: 'Database calls use transaction wrapper',
      evidence: ['src/db/users.ts:1'],
      confidence: 0.85,
    });

    const result = await constraint.validateChange(
      'src/db/products.ts',
      '',
      'export async function createProduct() { return db.query("SELECT 1"); }'
    );

    const warned = result.warnings.some((warning) => warning.constraint.rule.toLowerCase().includes('transaction'))
      || result.violations.some((violation) => violation.constraint.rule.toLowerCase().includes('transaction'));

    expect(warned).toBe(true);
  });

  it('high confidence correlates with success', async () => {
    const meta = new MetaKnowledgeEngine(storage, workspaceRoot);
    const goodTargetId = `${serviceModule.id}-good`;
    const badTargetId = `${criticalModule.id}-bad`;
    const goodPack = buildContextPack('pack-good', goodTargetId, [serviceModule.path], 0.9, {
      accessCount: 12,
      successCount: 10,
      failureCount: 1,
      lastOutcome: 'success',
    });
    const badPack = buildContextPack('pack-bad', badTargetId, [criticalModule.path], 0.4, {
      accessCount: 12,
      successCount: 1,
      failureCount: 8,
      lastOutcome: 'failure',
    });

    await storage.upsertContextPack(goodPack);
    await storage.upsertContextPack(badPack);

    const qualified = await meta.qualify([goodPack.packId, badPack.packId]);
    const good = qualified.find((entry) => entry.entityId === goodPack.packId);
    const bad = qualified.find((entry) => entry.entityId === badPack.packId);

    expect(good).toBeDefined();
    expect(bad).toBeDefined();
    expect((good?.confidence ?? 0)).toBeGreaterThan((bad?.confidence ?? 0));
  });

  it('proceed decision prevents high-risk work', async () => {
    const meta = new MetaKnowledgeEngine(storage, workspaceRoot);
    meta.markStale([criticalModule.id]);

    const decision = await meta.shouldProceed(['src/critical']);
    expect(decision.proceed).toBe(false);
    expect(decision.blockers?.some((blocker) => blocker.resolution === 'reindex')).toBe(true);
  });
});

function resolveTestEmbeddingDimension(): number {
  const raw = Number.parseInt(process.env.LIBRARIAN_TEST_EMBED_DIMENSION ?? '', 10);
  // Default to 64 dimensions - matches EmbeddingService default and Claude can reliably generate this count
  return Number.isFinite(raw) && raw > 0 ? raw : 64;
}
