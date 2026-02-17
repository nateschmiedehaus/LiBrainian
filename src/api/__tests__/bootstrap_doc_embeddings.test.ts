import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { bootstrapProject, createBootstrapConfig } from '../bootstrap.js';

describe('bootstrap doc embeddings', () => {
  let tempDir: string;
  let tempLinkDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-bootstrap-doc-'));
    tempLinkDir = path.join(os.tmpdir(), `librarian-bootstrap-doc-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'src', 'index.ts'),
      'export function hello() { return "world"; }\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(tempDir, 'README.md'),
      ['# Test Workspace', '', 'This is a test README for embedding generation.'].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(tempDir, 'main.py'),
      'def hello() -> str:\n    return "world"\n',
      'utf8'
    );
    await fs.symlink(tempDir, tempLinkDir, 'dir');
  });

  afterEach(async () => {
    await fs.rm(tempLinkDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates embeddings for high-relevance documentation even without embeddingService passed', async () => {
    const dbPath = path.join(tempDir, '.librarian', 'librarian.sqlite');
    const storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
    try {
      const config = createBootstrapConfig(tempDir, {
        bootstrapMode: 'full',
        skipLlm: true,
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        forceReindex: true,
      });
      const report = await bootstrapProject(config, storage);
      expect(report.success).toBe(true);

      const embedding = await storage.getEmbedding('doc:README.md');
      expect(embedding).not.toBeNull();
      expect(embedding?.length).toBeGreaterThan(0);
    } finally {
      await storage.close();
    }
  });

  it('bootstraps successfully when workspace path is a symlink', async () => {
    const dbPath = path.join(tempLinkDir, '.librarian', 'librarian.sqlite');
    const storage = createSqliteStorage(dbPath, tempLinkDir);
    await storage.initialize();
    try {
      const config = createBootstrapConfig(tempLinkDir, {
        bootstrapMode: 'fast',
        skipLlm: true,
        include: ['**/*.py'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        forceReindex: true,
      });
      const report = await bootstrapProject(config, storage);
      expect(report.success).toBe(true);
      expect(report.workspace).toBe(path.resolve(tempDir));
      expect(report.totalFilesProcessed).toBeGreaterThan(0);
    } finally {
      await storage.close();
    }
  });
});
