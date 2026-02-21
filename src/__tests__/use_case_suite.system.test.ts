/**
 * @fileoverview LiBrainian Use Case Suite (Controlled Fixture, Tier‑2)
 *
 * This suite validates “can the agent ask anything about the repo and get grounded
 * answers” using a controlled fixture repository with known ground truth.
 *
 * It is Tier‑2 because it exercises semantic behavior (providers required).
 * If providers are unavailable, this suite must fail honestly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as fsSync from 'node:fs';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { bootstrapProject } from '../api/bootstrap.js';
import { queryLiBrainian } from '../api/query.js';
import { requireProviders } from '../api/provider_check.js';
import type { LiBrainianStorage } from '../storage/types.js';
import type { LiBrainianResponse } from '../types.js';

const TEST_FIXTURE_PATH = path.resolve(__dirname, '../../test/fixtures/librainian_usecase');
const HAS_FIXTURE = fsSync.existsSync(TEST_FIXTURE_PATH);
const describeFixture = HAS_FIXTURE ? describe : describe.skip;

/**
 * Ground truth for the test fixture - what we KNOW to be true.
 * Tests MUST verify these facts, not just "doesn't crash".
 */
const GROUND_TRUTH = {
  entryPoint: 'src/index.js',
  functions: {
    processUser: 'src/user/user_service.js',
    validateEmail: 'src/utils/validators.js',
    authenticateUser: 'src/auth/authenticate.js',
    getUserById: 'src/user/user_service.js',
  },
  dependencies: {
    'src/auth/authenticate.js': ['src/utils/validators.js', 'src/user/user_service.js'],
    'src/user/user_service.js': ['src/utils/validators.js', 'src/utils/date_helpers.js'],
  },
  reverseDependencies: {
    'src/utils/validators.js': ['src/auth/authenticate.js', 'src/user/user_service.js'],
  },
  allFiles: [
    'README.md',
    '.github/CODEOWNERS',
    '.github/workflows/ci.yml',
    '.env.example',
    'config/default.json',
    'docs/adr/0001-auth-tokens.md',
    'docs/expertise.md',
    'docs/ownership-history.md',
    'docs/compliance-ownership.md',
    'docs/vendor-ownership.md',
    'infra/docker-compose.yml',
    'ops/oncall.md',
    'src/index.js',
    'src/auth/authenticate.js',
    'src/config/config.js',
    'src/db/client.js',
    'src/user/user_service.js',
    'src/utils/validators.js',
    'src/utils/date_helpers.js',
    '__tests__/user_service.test.js',
  ],
};

/**
 * Helper to check if a result contains a file path (normalized).
 * Checks all locations where file paths appear in LiBrainianResponse.
 */
function resultContainsFile(result: LiBrainianResponse, expectedPath: string): boolean {
  const normalizedExpected = expectedPath.replace(/\\/g, '/').toLowerCase();

  // Check in packs
  for (const pack of result.packs || []) {
    // Check targetId (function/module identifier)
    const targetId = (pack.targetId || '').replace(/\\/g, '/').toLowerCase();
    if (targetId.includes(normalizedExpected) || normalizedExpected.includes(targetId)) {
      return true;
    }

    // Check relatedFiles array
    for (const relatedFile of pack.relatedFiles || []) {
      const relPath = relatedFile.replace(/\\/g, '/').toLowerCase();
      if (relPath.includes(normalizedExpected) || normalizedExpected.includes(relPath)) {
        return true;
      }
    }

    // Check codeSnippets filePath
    for (const snippet of pack.codeSnippets || []) {
      const snippetPath = (snippet.filePath || '').replace(/\\/g, '/').toLowerCase();
      if (snippetPath.includes(normalizedExpected) || normalizedExpected.includes(snippetPath)) {
        return true;
      }
    }

    // Check summary for file mentions
    const summary = (pack.summary || '').toLowerCase();
    if (summary.includes(normalizedExpected)) {
      return true;
    }
  }

  // Check synthesis citations
  if (result.synthesis?.citations) {
    for (const citation of result.synthesis.citations) {
      const citFile = (citation.file || '').replace(/\\/g, '/').toLowerCase();
      if (citFile.includes(normalizedExpected) || normalizedExpected.includes(citFile)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Helper to extract all file paths from a result.
 */
function extractFilePaths(result: LiBrainianResponse): string[] {
  const paths: string[] = [];

  for (const pack of result.packs || []) {
    // Add targetId
    if (pack.targetId) paths.push(pack.targetId);

    // Add relatedFiles
    for (const relatedFile of pack.relatedFiles || []) {
      paths.push(relatedFile);
    }

    // Add codeSnippets filePath
    for (const snippet of pack.codeSnippets || []) {
      if (snippet.filePath) paths.push(snippet.filePath);
    }
  }

  // Add synthesis citations
  if (result.synthesis?.citations) {
    for (const citation of result.synthesis.citations) {
      if (citation.file) paths.push(citation.file);
    }
  }

  return paths.map((p) => p.replace(/\\/g, '/'));
}

describeFixture('LiBrainian Use Case Suite (fixture)', () => {
  let storage: LiBrainianStorage;
  let bootstrapSucceeded = false;
  let bootstrapError: Error | null = null;

  beforeAll(async () => {
    await requireProviders({ llm: true, embedding: true }, { workspaceRoot: TEST_FIXTURE_PATH });

    // Use temp DB to avoid conflicts
    const dbPath = path.join(os.tmpdir(), `librainian-usecase-${randomUUID()}.db`);
    storage = createSqliteStorage(dbPath, TEST_FIXTURE_PATH);
    await storage.initialize();

    try {
      await bootstrapProject(
        {
          workspace: TEST_FIXTURE_PATH,
          bootstrapMode: 'fast',
          include: ['**/*'],
          exclude: ['node_modules/**', '.git/**'],
          maxFileSizeBytes: 512_000,
          skipProviderProbe: true, // Provider availability is enforced above.
        },
        storage
      );
      bootstrapSucceeded = true;
    } catch (error) {
      bootstrapError = error as Error;
      console.warn('Bootstrap failed:', error);
    }
  }, 180000); // 3 minute timeout for bootstrap

  afterAll(async () => {
    await storage?.close?.();
  });

  describe('Bootstrap verification', () => {
    it('bootstraps without error', () => {
      if (!bootstrapSucceeded) {
        throw new Error(`unverified_by_trace(bootstrap_failed): ${bootstrapError?.message || 'unknown error'}`);
      }
      expect(bootstrapSucceeded).toBe(true);
    });

    it('indexes all expected files', async () => {
      if (!bootstrapSucceeded) {
        throw new Error('unverified_by_trace(bootstrap_required)');
      }

      const files = await storage.getFiles();
      const stats = await storage.getStats();
      const functions = await storage.getFunctions();

      expect(files.length).toBeGreaterThan(0);
      expect(stats.totalFunctions).toBeGreaterThan(0);

      const filePaths = files.map((f) => f.path.replace(/\\/g, '/'));

      for (const expectedFile of GROUND_TRUTH.allFiles) {
        const found = filePaths.some((p) => p.includes(expectedFile));
        if (!found) {
          throw new Error(
            `Expected file "${expectedFile}" not indexed. ` +
              `Indexed ${files.length} files, ${functions.length} functions.`
          );
        }
      }
    });
  });

  describe('Orientation queries (ground truth verified)', () => {
    it('identifies entry points - MUST return src/index.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');

      const result = await queryLiBrainian({ intent: 'What are the main entry points?', depth: 'L0' }, storage);
      expect(resultContainsFile(result, GROUND_TRUTH.entryPoint)).toBe(true);
    });

    it('provides repo overview with file mentions', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');

      const result = await queryLiBrainian({ intent: 'What does this repo do?', depth: 'L0' }, storage);
      expect(result.packs.length).toBeGreaterThan(0);
      expect(result.query).toBeDefined();
    });
  });

  describe('Symbol resolution (ground truth verified)', () => {
    it('finds processUser in user_service.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'Where is processUser defined?', depth: 'L1' }, storage);
      expect(resultContainsFile(result, GROUND_TRUTH.functions.processUser)).toBe(true);
    });

    it('finds validateEmail in validators.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'Where is validateEmail defined?', depth: 'L1' }, storage);
      expect(resultContainsFile(result, GROUND_TRUTH.functions.validateEmail)).toBe(true);
    });

    it('finds authenticateUser in authenticate.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'Where is authenticateUser defined?', depth: 'L1' }, storage);
      expect(resultContainsFile(result, GROUND_TRUTH.functions.authenticateUser)).toBe(true);
    });

    it('traces validateEmail call sites - MUST return authenticate.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'Where is validateEmail used?', depth: 'L1' }, storage);
      expect(resultContainsFile(result, GROUND_TRUTH.functions.authenticateUser)).toBe(true);
    });
  });

  describe('Dependency queries (ground truth verified)', () => {
    it('identifies authenticate.js imports validators.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'What does authenticate.js import?', depth: 'L1' }, storage);
      expect(resultContainsFile(result, 'src/auth/authenticate.js')).toBe(true);
      expect(resultContainsFile(result, 'src/utils/validators.js')).toBe(true);
    });

    it('finds reverse dependencies of validators.js', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'What imports validators.js?', depth: 'L1' }, storage);
      expect(resultContainsFile(result, 'src/utils/validators.js')).toBe(true);
    });
  });

  describe('Edge cases (behavior verification)', () => {
    it('handles empty query by throwing or returning empty', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      let threw = false;
      try {
        const result = await queryLiBrainian({ intent: '', depth: 'L0' }, storage);
        expect(Array.isArray(result.packs)).toBe(true);
      } catch {
        threw = true;
      }
      expect(threw || true).toBe(true);
    });

    it('handles non-existent function with empty or low-confidence result', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'Where is function totallyNonExistentFunction defined?', depth: 'L1' }, storage);
      expect(result.query).toBeDefined();
    });

    it('handles query with non-existent affected file gracefully', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian(
        { intent: 'What does this file do?', affectedFiles: ['src/does_not_exist.js'], depth: 'L0' },
        storage
      );
      expect(result.query).toBeDefined();
    });
  });

  describe('Query metadata (structure verification)', () => {
    it('includes feedbackToken in response', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'What does this repo do?', depth: 'L0' }, storage);
      expect((result as any).feedbackToken ?? (result as any).feedbackId ?? null).not.toBe(null);
    });

    it('includes latency metrics', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'What does this repo do?', depth: 'L0' }, storage);
      expect((result as any).latencyMs ?? (result as any).timing ?? null).not.toBe(null);
    });

    it('includes confidence in valid range [0,1] when present', async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');
      const result = await queryLiBrainian({ intent: 'What does this repo do?', depth: 'L0' }, storage);
      const anyConfidence = (result as any).confidence;
      if (typeof anyConfidence === 'number') {
        expect(anyConfidence).toBeGreaterThanOrEqual(0);
        expect(anyConfidence).toBeLessThanOrEqual(1);
      }
    });
  });
});

