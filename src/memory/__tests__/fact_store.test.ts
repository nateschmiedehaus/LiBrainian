import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addMemoryFact,
  deleteMemoryFact,
  getMemoryStoreStats,
  listMemoryFacts,
  searchMemoryFacts,
  updateMemoryFact,
} from '../fact_store.js';

const tmpDirs: string[] = [];

async function mkWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-memory-store-'));
  tmpDirs.push(dir);
  return dir;
}

describe('fact_store', () => {
  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('adds and retrieves memory facts by semantic query', async () => {
    const workspace = await mkWorkspace();
    const added = await addMemoryFact(workspace, {
      content: 'validateToken has race condition under concurrent refresh',
      scope: 'function',
      scopeKey: 'validateToken',
      source: 'agent',
      confidence: 0.82,
    });

    expect(added.action).toBe('added');
    expect(added.fact.id.length).toBeGreaterThan(10);

    const results = await searchMemoryFacts(workspace, 'auth token validation race issue', {
      limit: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content.toLowerCase()).toContain('race condition');
    expect(results[0]?.score ?? 0).toBeGreaterThan(0.1);
  });

  it('deduplicates similar facts as an update instead of creating duplicates', async () => {
    const workspace = await mkWorkspace();
    const first = await addMemoryFact(workspace, {
      content: 'validateToken has race condition on refresh',
      scope: 'function',
      scopeKey: 'validateToken',
    });
    const second = await addMemoryFact(workspace, {
      content: 'validateToken race condition under token refresh',
      scope: 'function',
      scopeKey: 'validateToken',
      confidence: 0.9,
    });

    expect(first.fact.id).toBe(second.fact.id);
    expect(second.action).toBe('updated');
    const facts = await listMemoryFacts(workspace, 20);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.content).toContain('token refresh');
  });

  it('supports explicit update/delete and reports stats', async () => {
    const workspace = await mkWorkspace();
    const added = await addMemoryFact(workspace, {
      content: 'Payments retry path is not idempotent for duplicate webhooks',
      scope: 'module',
      scopeKey: 'src/payments/webhook.ts',
      source: 'analysis',
    });

    const updated = await updateMemoryFact(
      workspace,
      added.fact.id,
      'Payments webhook retry path is not idempotent for duplicate events',
    );
    expect(updated.content).toContain('duplicate events');

    const beforeDelete = await getMemoryStoreStats(workspace);
    expect(beforeDelete.totalFacts).toBe(1);
    expect(beforeDelete.oldestFactAt).toBeTruthy();

    const deleted = await deleteMemoryFact(workspace, added.fact.id);
    expect(deleted).toBe(true);

    const afterDelete = await getMemoryStoreStats(workspace);
    expect(afterDelete.totalFacts).toBe(0);
    expect(afterDelete.oldestFactAt).toBeNull();
  });
});
