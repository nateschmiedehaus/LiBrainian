import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { queryLibrarian } from '../query.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { getCurrentVersion } from '../../index.js';

describe('query filesystem fallback', () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
  });

  it('returns source-backed packs when indexed context packs are unavailable', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-fallback-'));
    workspaces.push(workspace);

    const sourceDir = path.join(workspace, 'src', 'api');
    const sourceFile = path.join(sourceDir, 'query.ts');
    await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(sourceFile, [
      'export const QUERY_PIPELINE_STAGES = [\'adequacy_scan\', \'semantic_retrieval\', \'reranking\', \'synthesis\'];',
      'export function queryPipeline() {',
      '  return QUERY_PIPELINE_STAGES;',
      '}',
      '',
    ].join('\n'), 'utf8');

    const storage = createSqliteStorage(path.join(workspace, '.librarian', 'librarian.sqlite'), workspace);
    await storage.initialize();
    await storage.setMetadata({
      version: getCurrentVersion(),
      workspace,
      lastBootstrap: new Date(),
      lastIndexing: new Date(),
      totalFiles: 1,
      totalFunctions: 0,
      totalContextPacks: 0,
      qualityTier: 'mvp',
    });

    try {
      const response = await queryLibrarian({
        intent: 'Where is the query pipeline implemented and what are its stages?',
        depth: 'L0',
        llmRequirement: 'disabled',
      }, storage);

      expect(response.packs.length).toBeGreaterThan(0);
      expect(response.retrievalStatus).not.toBe('insufficient');
      expect(response.packs[0]?.relatedFiles).toContain('src/api/query.ts');
      expect(response.packs[0]?.keyFacts.join(' ')).toContain('Matched terms');
    } finally {
      await storage.close();
    }
  });

  it('deprioritizes dead-code trap paths when a live exported match exists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-fallback-dead-code-'));
    workspaces.push(workspace);

    await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'src', 'live'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'src', 'dead'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'live', 'billingPolicy.ts'), [
      'export interface Invoice { id: string; daysOverdue: number; }',
      'export function enforceActiveBillingPolicy(invoice: Invoice) {',
      '  return invoice.daysOverdue >= 30 ? \"pay-now\" : \"allow-grace-period\";',
      '}',
      'export const ACTIVE_BILLING_POLICY = \"active-billing-policy-enforcement\";',
      '',
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(workspace, 'src', 'dead', 'legacyBilling.ts'), [
      '/*',
      'LEGACY BILLING ENGINE (DEAD CODE)',
      'This block intentionally contains misleading terms like billing policy,',
      'overdue invoice processing, and payment enforcement.',
      '*/',
      'export const LEGACY_BILLING_DEAD_CODE = true;',
      '',
    ].join('\n'), 'utf8');

    const storage = createSqliteStorage(path.join(workspace, '.librarian', 'librarian.sqlite'), workspace);
    await storage.initialize();
    await storage.setMetadata({
      version: getCurrentVersion(),
      workspace,
      lastBootstrap: new Date(),
      lastIndexing: new Date(),
      totalFiles: 2,
      totalFunctions: 0,
      totalContextPacks: 0,
      qualityTier: 'mvp',
    });

    try {
      const response = await queryLibrarian({
        intent: 'Locate ACTIVE_BILLING_POLICY enforcement for overdue invoice handling.',
        depth: 'L0',
        llmRequirement: 'disabled',
      }, storage);

      expect(response.packs.length).toBeGreaterThan(0);
      expect(response.packs[0]?.relatedFiles).toContain('src/live/billingPolicy.ts');
      expect(response.packs[0]?.relatedFiles).not.toContain('src/dead/legacyBilling.ts');
    } finally {
      await storage.close();
    }
  });
});
