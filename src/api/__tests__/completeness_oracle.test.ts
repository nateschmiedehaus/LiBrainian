import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import {
  runCompletenessOracle,
  type CompletenessCounterevidence,
} from '../completeness_oracle.js';

function createFunction(filePath: string, name: string, index: number) {
  return {
    id: `fn-${index}-${name}`,
    filePath,
    name,
    signature: `${name}(): Promise<void>`,
    purpose: `Function ${name}`,
    startLine: 1,
    endLine: 20,
    confidence: 0.8,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

async function seedCrudExamples(storage: LibrarianStorage, workspaceRoot: string, names: string[]): Promise<void> {
  let idx = 0;
  for (const name of names) {
    const token = name.toLowerCase();
    const baseFile = path.join(workspaceRoot, 'src', `${token}.ts`);
    await storage.upsertFunction(createFunction(baseFile, `create${name}`, idx++));

    await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'src', 'routes', `${token}.ts`), `route${name}`, idx++));
    await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'tests', `${token}.test.ts`), `test${name}`, idx++));
    await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'migrations', `${token}.sql.ts`), `migration${name}`, idx++));
    await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'specs', 'openapi.ts'), `openapi${name}`, idx++));
  }
}

describe('runCompletenessOracle', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const root of tempRoots) {
      await fs.rm(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it('builds templates and reports enforced gaps with evidence examples', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-completeness-'));
    tempRoots.push(workspaceRoot);
    const dbPath = path.join(workspaceRoot, '.librarian', `oracle-${randomUUID()}.sqlite`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath, workspaceRoot);
    await storage.initialize();

    try {
      await seedCrudExamples(storage, workspaceRoot, ['User', 'Invoice', 'Product', 'Cart', 'Team', 'Project']);
      await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'src', 'order.ts'), 'createOrder', 999));

      const report = await runCompletenessOracle({
        workspaceRoot,
        storage,
        changedFiles: ['src/order.ts'],
        mode: 'changed',
        supportThreshold: 5,
      });

      expect(report.templates.some((template) => template.pattern === 'crud_function' && template.artifact === 'migration')).toBe(true);
      const migrationGap = report.gaps.find((gap) => gap.file === 'src/order.ts' && gap.artifact === 'migration');
      expect(migrationGap).toBeDefined();
      expect(migrationGap?.support).toBeGreaterThanOrEqual(6);
      expect(migrationGap?.examples.length).toBeGreaterThanOrEqual(2);
      expect(migrationGap?.examples.length).toBeLessThanOrEqual(3);
    } finally {
      await storage.close();
    }
  });

  it('labels low-support templates as informational suggestions', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-completeness-'));
    tempRoots.push(workspaceRoot);
    const dbPath = path.join(workspaceRoot, '.librarian', `oracle-${randomUUID()}.sqlite`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath, workspaceRoot);
    await storage.initialize();

    try {
      await seedCrudExamples(storage, workspaceRoot, ['User', 'Invoice', 'Product']);
      await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'src', 'task.ts'), 'createTask', 300));

      const report = await runCompletenessOracle({
        workspaceRoot,
        storage,
        changedFiles: ['src/task.ts'],
        mode: 'changed',
        supportThreshold: 5,
      });

      expect(report.gaps.length).toBe(0);
      expect(report.suggestions.some((gap) => gap.file === 'src/task.ts' && gap.artifact === 'migration')).toBe(true);
    } finally {
      await storage.close();
    }
  });

  it('applies counterevidence and suppresses low-confidence false positives', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-completeness-'));
    tempRoots.push(workspaceRoot);
    const dbPath = path.join(workspaceRoot, '.librarian', `oracle-${randomUUID()}.sqlite`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath, workspaceRoot);
    await storage.initialize();

    try {
      await seedCrudExamples(storage, workspaceRoot, ['User', 'Invoice', 'Product', 'Cart', 'Team', 'Project']);
      await storage.upsertFunction(createFunction(path.join(workspaceRoot, 'src', 'order.ts'), 'createOrder', 700));

      const counterevidence: CompletenessCounterevidence[] = [
        {
          artifact: 'migration',
          pattern: 'crud_function',
          filePattern: 'src/order\\.ts$',
          reason: 'Order creation is write-through to an external billing service; no local migration required.',
          weight: 0.95,
        },
        {
          artifact: 'openapi_entry',
          pattern: 'crud_function',
          filePattern: 'src/order\\.ts$',
          reason: 'Order endpoint is internal and intentionally excluded from public OpenAPI spec.',
          weight: 0.95,
        },
        {
          artifact: 'api_route',
          pattern: 'crud_function',
          filePattern: 'src/order\\.ts$',
          reason: 'Order creation is triggered asynchronously from queue consumers only.',
          weight: 0.95,
        },
      ];

      const report = await runCompletenessOracle({
        workspaceRoot,
        storage,
        changedFiles: ['src/order.ts'],
        mode: 'changed',
        supportThreshold: 5,
        counterevidence,
      });

      expect(report.counterevidence.configured).toBe(3);
      expect(report.counterevidence.suppressed).toBeGreaterThanOrEqual(1);
      expect(report.falsePositiveRateEstimate).toBeLessThan(0.15);
      expect(report.gaps.every((gap) => gap.artifact !== 'migration')).toBe(true);
    } finally {
      await storage.close();
    }
  });
});
