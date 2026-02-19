import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { bootstrapProject, createBootstrapConfig } from '../bootstrap.js';

const SOURCE_INCLUDE = ['**/CODEOWNERS'];
const SOURCE_EXCLUDE = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];

describe('bootstrap upgrade preservation', () => {
  let workspace: string;
  let storage: ReturnType<typeof createSqliteStorage>;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-bootstrap-upgrade-preserve-'));
    await fs.writeFile(path.join(workspace, 'CODEOWNERS'), '* @team/librarian\n', 'utf8');

    const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('does not purge existing index data before fast->full bootstrap upgrade completes', async () => {
    const fastConfig = createBootstrapConfig(workspace, {
      bootstrapMode: 'fast',
      skipLlm: true,
      skipEmbeddings: true,
      include: SOURCE_INCLUDE,
      exclude: SOURCE_EXCLUDE,
      forceReindex: true,
    });

    const fastReport = await bootstrapProject(fastConfig, storage);
    expect(fastReport.success).toBe(true);

    const syntheticModulePath = path.join(workspace, 'seed', 'seed_module.ts');

    await storage.upsertFunction({
      id: 'func:seed',
      filePath: syntheticModulePath,
      name: 'seedFunction',
      signature: 'seedFunction() => void',
      purpose: 'Seed function for upgrade preservation test',
      startLine: 1,
      endLine: 1,
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    });

    await storage.upsertModule({
      id: 'mod:seed',
      path: syntheticModulePath,
      purpose: 'Seed module for upgrade preservation test',
      exports: ['seedFunction'],
      dependencies: [],
      confidence: 0.9,
    });

    await storage.upsertContextPack({
      packId: 'pack:seed',
      packType: 'function_context',
      targetId: 'func:seed',
      summary: 'Seed pack',
      keyFacts: ['seed'],
      codeSnippets: [
        {
          filePath: syntheticModulePath,
          startLine: 1,
          endLine: 1,
          content: 'export function seedFunction() {}',
          language: 'typescript',
        },
      ],
      relatedFiles: [syntheticModulePath],
      confidence: 0.9,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: fastReport.version,
      invalidationTriggers: [syntheticModulePath],
    });

    expect((await storage.getFunctions({ limit: 10 })).some((fn) => fn.id === 'func:seed')).toBe(true);
    expect((await storage.getModules({ limit: 10 })).some((mod) => mod.id === 'mod:seed')).toBe(true);
    expect((await storage.getContextPacks({ limit: 10, includeInvalidated: true })).some((pack) => pack.packId === 'pack:seed')).toBe(true);

    const deleteFunctionSpy = vi.spyOn(storage, 'deleteFunction');
    const deleteModuleSpy = vi.spyOn(storage, 'deleteModule');
    const deleteContextPackSpy = vi.spyOn(storage, 'deleteContextPack');

    const fullConfig = createBootstrapConfig(workspace, {
      bootstrapMode: 'full',
      skipLlm: true,
      skipEmbeddings: true,
      include: SOURCE_INCLUDE,
      exclude: SOURCE_EXCLUDE,
    });

    const fullReport = await bootstrapProject(fullConfig, storage);
    expect(fullReport.success).toBe(true);
    expect(deleteFunctionSpy).not.toHaveBeenCalled();
    expect(deleteModuleSpy).not.toHaveBeenCalled();
    expect(deleteContextPackSpy).not.toHaveBeenCalled();
  });
});
