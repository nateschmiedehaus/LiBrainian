import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSelfIndexGateConstruction } from '../self_index_gate.js';

const tempRoots: string[] = [];

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-self-index-gate-'));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('Self-Index Gate', () => {
  it('bootstraps and validates self-referential query checks', async () => {
    const fixture = await createFixture({
      'src/constructions/registry.ts': [
        'export function listConstructions(): string[] {',
        "  return ['self-index-gate'];",
        '}',
      ].join('\n'),
      'src/api/query.ts': [
        "import { listConstructions } from '../constructions/registry';",
        'export function runQueryPipeline(intent: string): string {',
        '  return `${intent}:${listConstructions().length}`;',
        '}',
      ].join('\n'),
      'src/api/query_interface.ts': [
        'export interface QueryRequest { intent: string }',
        'export function normalizeIntent(intent: string): string {',
        '  return intent.trim().toLowerCase();',
        '}',
      ].join('\n'),
      'src/bootstrap/start.ts': [
        'export function bootstrapWorkspace(): boolean {',
        '  return true;',
        '}',
      ].join('\n'),
      'src/mcp/server.ts': [
        "import { runQueryPipeline } from '../api/query';",
        'export function handleMcpQuery(intent: string): string {',
        '  return runQueryPipeline(intent);',
        '}',
      ].join('\n'),
      'src/storage/sqlite_storage.ts': [
        'export class SqliteStorage {',
        '  getEngine(): string { return "sqlite"; }',
        '}',
      ].join('\n'),
    });

    const gate = createSelfIndexGateConstruction();
    const outcome = await gate.execute({
      fixtures: [
        {
          name: 'self-index-mini',
          repoPath: fixture,
          queries: [
            {
              id: 'construction_system_architecture',
              query: 'construction system architecture',
              expectedFiles: ['src/constructions/'],
            },
            {
              id: 'query_pipeline',
              query: 'query pipeline',
              expectedFiles: ['src/api/query.ts', 'src/api/query_interface.ts'],
            },
            {
              id: 'bootstrap_flow',
              query: 'bootstrap pipeline initialization flow',
              expectedFiles: ['src/bootstrap/'],
            },
            {
              id: 'mcp_server',
              query: 'MCP server tools and protocol handling',
              expectedFiles: ['src/mcp/server.ts'],
            },
            {
              id: 'storage_layer',
              query: 'storage layer sqlite and embeddings',
              expectedFiles: ['src/storage/'],
            },
          ],
        },
      ],
      k: 5,
      precisionThreshold: 0.2,
      maxDurationMs: 300_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const result = outcome.value;

    expect(result.kind).toBe('SelfIndexGateResult.v1');
    expect(result.fixtures).toHaveLength(1);
    expect(result.fixtures[0]?.sourceTsFileCount).toBe(6);
    expect(result.fixtures[0]?.indexedSourceTsFileCount).toBe(6);
    expect(result.fixtures[0]?.queryResults).toHaveLength(5);
    expect(result.fixtures[0]?.constructionQueryMatched).toBe(true);
    expect(result.fixtures[0]?.queryPipelineMatched).toBe(true);
    expect(result.fixtures[0]?.avgPrecisionAtK).toBeGreaterThan(0);
    expect(
      result.fixtures[0]?.queryResults.some((queryResult) => queryResult.precisionAtK >= 0.2),
    ).toBe(true);
  }, 160_000);
});
