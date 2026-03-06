import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { SwarmRunner } from '../swarm_runner.js';
import { SqliteLibrarianStorage } from '../../storage/sqlite_storage.js';

async function sha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

describe('SwarmRunner checkpoint consistency', () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
  });

  it('reindexes files when the checkpoint says up-to-date but storage is missing indexed artifacts', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-swarm-checkpoint-'));
    workspaces.push(workspace);

    const sourceDir = path.join(workspace, 'src');
    const filePath = path.join(sourceDir, 'query.ts');
    await fs.mkdir(path.join(workspace, '.librarian', 'swarm'), { recursive: true });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(filePath, 'export function queryPipeline() { return ["retrieve", "rerank", "synthesize"]; }\n', 'utf8');

    const checkpointPath = path.join(workspace, '.librarian', 'swarm', 'checkpoint.json');
    const contentHash = await sha256(filePath);
    await fs.writeFile(checkpointPath, JSON.stringify({
      schemaVersion: 2,
      indexerVersion: '2.0.0',
      configFingerprint: {
        useAstIndexer: true,
        generateEmbeddings: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: {
        [filePath]: {
          contentHash,
          processedAt: new Date().toISOString(),
          indexerVersion: '2.0.0',
        },
      },
    }, null, 2), 'utf8');

    const storage = new SqliteLibrarianStorage(path.join(workspace, '.librarian', 'librarian.sqlite'));
    await storage.initialize();

    try {
      const result = await new SwarmRunner({
        storage,
        workspace,
        maxWorkers: 2,
        maxFileSizeBytes: 1024 * 1024,
        useAstIndexer: true,
        generateEmbeddings: false,
        persistGraphMetrics: false,
      }).run([filePath]);

      expect(result.files).toBe(1);
      expect(await storage.getFileChecksum(filePath)).toBeTruthy();

      const stats = await storage.getStats();
      expect(stats.totalModules).toBeGreaterThanOrEqual(1);
      expect(stats.totalFunctions).toBeGreaterThanOrEqual(1);
    } finally {
      await storage.close();
    }
  });
});
