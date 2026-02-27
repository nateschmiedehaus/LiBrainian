/**
 * @fileoverview UC-001…UC-030 (L0 Foundation) end-to-end suite (Tier‑2)
 *
 * This suite exists to make the “world-class knowledge tool” claim non-theatrical:
 * - It runs the first 30 canonical use cases from docs/archive/USE_CASE_MATRIX.md.
 * - It requires live providers (LLM + embeddings). If unavailable, it must fail honestly.
 * - It asserts stable, observable invariants against a controlled fixture repo,
 *   without overfitting to any particular phrasing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import * as fsSync from 'node:fs';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { bootstrapProject } from '../api/bootstrap.js';
import { queryLibrarian } from '../api/query.js';
import { requireProviders } from '../api/provider_check.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianResponse } from '../types.js';

const TEST_FIXTURE_PATH = path.resolve(__dirname, '../../test/fixtures/librarian_usecase');
const HAS_FIXTURE = fsSync.existsSync(TEST_FIXTURE_PATH);
const describeFixture = HAS_FIXTURE ? describe : describe.skip;

type UcCase = {
  id: string;
  intent: string;
  expectMentions: string[];
};

function resultContainsAnyFile(result: LibrarianResponse, expectedPaths: string[]): boolean {
  const expected = expectedPaths.map((p) => p.replace(/\\/g, '/').toLowerCase());

  for (const pack of result.packs || []) {
    const targetId = (pack.targetId || '').replace(/\\/g, '/').toLowerCase();
    for (const exp of expected) {
      if (targetId.includes(exp) || exp.includes(targetId)) return true;
    }

    for (const relatedFile of pack.relatedFiles || []) {
      const relPath = (relatedFile || '').replace(/\\/g, '/').toLowerCase();
      for (const exp of expected) {
        if (relPath.includes(exp) || exp.includes(relPath)) return true;
      }
    }

    for (const snippet of pack.codeSnippets || []) {
      const snippetPath = (snippet.filePath || '').replace(/\\/g, '/').toLowerCase();
      for (const exp of expected) {
        if (snippetPath.includes(exp) || exp.includes(snippetPath)) return true;
      }
    }
  }

  if (result.synthesis?.citations) {
    for (const citation of result.synthesis.citations) {
      const citFile = (citation.file || '').replace(/\\/g, '/').toLowerCase();
      for (const exp of expected) {
        if (citFile.includes(exp) || exp.includes(citFile)) return true;
      }
    }
  }

  return false;
}

// UC-001…UC-030, aligned to fixture artifacts so the tests can assert concrete grounding.
const UC_L0_FOUNDATION: UcCase[] = [
  { id: 'UC-001', intent: 'Inventory files, languages, build tools', expectMentions: ['package.json', '.github/workflows/ci.yml'] },
  { id: 'UC-002', intent: 'Identify repo entry points and main commands', expectMentions: ['src/index.js', 'package.json'] },
  { id: 'UC-003', intent: 'Produce a domain glossary from code and docs', expectMentions: ['README.md', 'src/auth/authenticate.js'] },
  { id: 'UC-004', intent: 'Detect primary runtime environments and targets', expectMentions: ['package.json', 'infra/docker-compose.yml'] },
  { id: 'UC-005', intent: 'Enumerate external services and dependencies', expectMentions: ['infra/docker-compose.yml', 'src/db/client.js'] },
  { id: 'UC-006', intent: 'Map build/test entrypoints and scripts', expectMentions: ['package.json', '.github/workflows/ci.yml', '__tests__/user_service.test.js'] },
  { id: 'UC-007', intent: 'Identify data stores and schema locations', expectMentions: ['infra/docker-compose.yml', 'config/default.json'] },
  { id: 'UC-008', intent: 'Locate configuration sources and overrides', expectMentions: ['.env.example', 'config/default.json', 'src/config/config.js'] },
  { id: 'UC-009', intent: 'Detect critical paths and business flows', expectMentions: ['src/auth/authenticate.js', 'src/user/user_service.js'] },
  { id: 'UC-010', intent: 'Summarize repository purpose and scope', expectMentions: ['README.md'] },

  { id: 'UC-011', intent: 'Produce component/module map', expectMentions: ['src/auth/authenticate.js', 'src/user/user_service.js'] },
  { id: 'UC-012', intent: 'Generate call graph and dependency graph', expectMentions: ['src/auth/authenticate.js', 'src/utils/validators.js'] },
  { id: 'UC-013', intent: 'Identify cross-cutting concerns (auth, config, validation)', expectMentions: ['src/utils/validators.js', 'src/config/config.js'] },
  { id: 'UC-014', intent: 'Map dataflow across components', expectMentions: ['src/auth/authenticate.js', 'src/user/user_service.js'] },
  { id: 'UC-015', intent: 'Document system boundaries and interfaces', expectMentions: ['src/index.js'] },
  { id: 'UC-016', intent: 'Classify architectural styles and constraints', expectMentions: ['README.md', 'src/index.js'] },
  { id: 'UC-017', intent: 'Identify architectural risks and debt', expectMentions: ['src/auth/authenticate.js'] },
  { id: 'UC-018', intent: 'Map runtime topology (services, jobs)', expectMentions: ['infra/docker-compose.yml'] },
  { id: 'UC-019', intent: 'Align code structure to domain model', expectMentions: ['README.md', 'src/user/user_service.js'] },
  { id: 'UC-020', intent: 'Provide architecture decision history', expectMentions: ['docs/adr/0001-auth-tokens.md'] },

  { id: 'UC-021', intent: 'Identify code owners and maintainers', expectMentions: ['.github/CODEOWNERS'] },
  { id: 'UC-022', intent: 'Map teams to components and domains', expectMentions: ['.github/CODEOWNERS', 'src/auth/authenticate.js'] },
  { id: 'UC-023', intent: 'Detect orphaned or unowned areas', expectMentions: ['.github/CODEOWNERS'] },
  { id: 'UC-024', intent: 'Identify review paths and approval rules', expectMentions: ['.github/CODEOWNERS', '.github/workflows/ci.yml'] },
  { id: 'UC-025', intent: 'Map on-call and escalation paths', expectMentions: ['ops/oncall.md'] },
  { id: 'UC-026', intent: 'Track expertise hotspots (subject matter)', expectMentions: ['docs/expertise.md'] },
  { id: 'UC-027', intent: 'Identify code stewardship risks', expectMentions: ['docs/ownership-history.md'] },
  { id: 'UC-028', intent: 'Determine compliance ownership boundaries', expectMentions: ['docs/compliance-ownership.md'] },
  { id: 'UC-029', intent: 'Map vendor and third-party ownership', expectMentions: ['docs/vendor-ownership.md', 'package.json'] },
  { id: 'UC-030', intent: 'Establish ownership change history', expectMentions: ['docs/ownership-history.md'] },
];

describeFixture('UC-001…UC-030 (L0 Foundation) end-to-end', () => {
  let storage: LibrarianStorage;
  let bootstrapSucceeded = false;
  let bootstrapError: Error | null = null;

  beforeAll(async () => {
    await requireProviders({ llm: true, embedding: true }, { workspaceRoot: TEST_FIXTURE_PATH });

    const dbPath = path.join(os.tmpdir(), `librarian-usecase-system-${randomUUID()}.db`);
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
    }
  }, 180_000);

  afterAll(async () => {
    await storage?.close?.();
  });

  it('bootstraps the fixture successfully', () => {
    if (!bootstrapSucceeded) {
      throw new Error(`unverified_by_trace(bootstrap_failed): ${bootstrapError?.message ?? 'unknown'}`);
    }
    expect(bootstrapSucceeded).toBe(true);
  });

  for (const uc of UC_L0_FOUNDATION) {
    it(`${uc.id}: ${uc.intent}`, async () => {
      if (!bootstrapSucceeded) throw new Error('unverified_by_trace(bootstrap_required)');

      const result = await queryLibrarian(
        {
          intent: `${uc.id}: ${uc.intent}`,
          depth: 'L0',
        },
        storage
      );

      expect(Array.isArray(result.packs)).toBe(true);
      expect(result.query).toBeDefined();

      const grounded = resultContainsAnyFile(result, uc.expectMentions);
      if (!grounded) {
        const hint = uc.expectMentions.join(', ');
        throw new Error(`unverified_by_trace(use_case_not_grounded): ${uc.id} expected mentions: ${hint}`);
      }
      expect(grounded).toBe(true);
    }, 90_000);
  }
});
