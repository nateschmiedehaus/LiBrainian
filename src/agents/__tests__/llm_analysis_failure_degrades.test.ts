import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { withLlmServiceAdapter, type LlmServiceAdapter } from '../../adapters/llm_service.js';
import { AstIndexer } from '../ast_indexer.js';
import { IndexLibrarian } from '../index_librarian.js';
import { SqliteLibrarianStorage } from '../../storage/sqlite_storage.js';

function createFailingLlmAdapter(): LlmServiceAdapter {
  return {
    async chat() {
      throw new Error('unverified_by_trace(llm_execution_failed): Limit reached (test)');
    },
    async checkClaudeHealth() {
      return {
        provider: 'claude',
        available: false,
        authenticated: true,
        lastCheck: Date.now(),
        error: 'Limit reached (test)',
      };
    },
    async checkCodexHealth() {
      return {
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: Date.now(),
        error: 'Not configured (test)',
      };
    },
  };
}

describe('LLM analysis failure degradation', () => {
  it('AstIndexer still returns deterministic AST results when per-file analysis fails', async () => {
    await withLlmServiceAdapter(createFailingLlmAdapter(), async () => {
      const indexer = new AstIndexer({
        llmProvider: 'claude',
        llmModelId: 'test',
        enableAnalysis: true,
        enableLlmFallback: false,
        enableEmbeddings: false,
      });

      const result = await indexer.indexFile('/tmp/example.ts', 'export function ok() { return 1; }');
      expect(result.functions.length).toBe(1);
      expect(result.partiallyIndexed).toBe(true);
    });
  });

  it('IndexLibrarian still indexes files when per-file analysis fails (no 0-files state)', async () => {
    await withLlmServiceAdapter(createFailingLlmAdapter(), async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-llm-analysis-fail-'));
      const filePath = path.join(workspaceDir, 'src', 'index.ts');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'export function ok() { return 1; }\n', 'utf8');

      const dbPath = path.join(workspaceDir, 'librarian.sqlite');
      const storage = new SqliteLibrarianStorage(dbPath);
      await storage.initialize();

      try {
        const indexer = new IndexLibrarian({
          generateEmbeddings: false,
          createContextPacks: false,
          useAstIndexer: true,
          llmProvider: 'claude',
          llmModelId: 'test',
          enableLlmAnalysis: true,
          extensions: ['.ts'],
          workspaceRoot: workspaceDir,
          computeGraphMetrics: false,
        });
        await indexer.initialize(storage);

        const result = await indexer.processTask({
          type: 'full',
          paths: [filePath],
          priority: 'high',
          reason: 'test',
          triggeredBy: 'test',
        });

        expect(result.filesProcessed).toBe(1);
        expect(result.functionsIndexed).toBeGreaterThanOrEqual(1);
        expect(result.errors.some((e) => e.path === filePath)).toBe(true);
      } finally {
        await storage.close();
        await fs.rm(workspaceDir, { recursive: true, force: true });
      }
    });
  });

  it('IndexLibrarian does not exclude files when workspace path contains eval-corpus/external-repos', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-eval-root-'));
    const workspaceDir = path.join(root, 'eval-corpus', 'external-repos', 'fixture');
    const filePath = path.join(workspaceDir, 'src', 'index.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export function ok() { return 1; }\n', 'utf8');

    const dbPath = path.join(workspaceDir, 'librarian.sqlite');
    const storage = new SqliteLibrarianStorage(dbPath);
    await storage.initialize();

    try {
      const indexer = new IndexLibrarian({
        generateEmbeddings: false,
        createContextPacks: false,
        useAstIndexer: true,
        extensions: ['.ts'],
        workspaceRoot: workspaceDir,
        computeGraphMetrics: false,
      });
      await indexer.initialize(storage);

      const result = await indexer.processTask({
        type: 'full',
        paths: [filePath],
        priority: 'high',
        reason: 'test',
        triggeredBy: 'test',
      });

      expect(result.filesProcessed).toBe(1);
      expect(result.errors.some((entry) => entry.error === 'File excluded by configuration')).toBe(false);
    } finally {
      await storage.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
